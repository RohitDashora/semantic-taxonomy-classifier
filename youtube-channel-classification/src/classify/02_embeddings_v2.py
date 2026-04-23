# Databricks notebook source
# MAGIC %md
# MAGIC # Step 02 (v2): Multi-Embedding Generation
# MAGIC
# MAGIC Generate up to **3 embeddings per channel**:
# MAGIC 1. `channel_embedding` — from channel profile text (always present)
# MAGIC 2. `video1_embedding` — from top video text (if enrichment was run)
# MAGIC 3. `video2_embedding` — from second video text (if enrichment was run)
# MAGIC
# MAGIC Uses the same Foundation Model API (`databricks-gte-large-en`, 1024-dim) as v1.
# MAGIC
# MAGIC **Input:** Prepped channels table with `channel_text`, `video1_text`, `video2_text`
# MAGIC **Output:**
# MAGIC - `channel_embeddings_v2` — multi-embedding table (new)
# MAGIC - `channels_embeddings` — legacy single-embedding table (backward compat for Explorer app)

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

import mlflow.deployments
import pandas as pd
import numpy as np
from pyspark.sql import functions as F
from pyspark.sql.functions import col, lit, when, pandas_udf, size
from pyspark.sql.types import ArrayType, FloatType, StructType, StructField, StringType

# COMMAND ----------

df = spark.table(PREPPED_TABLE)
total = df.count()

has_video1 = df.filter(col("video1_text").isNotNull() & (col("video1_text") != "")).count()
has_video2 = df.filter(col("video2_text").isNotNull() & (col("video2_text") != "")).count()

print(f"Channels to embed: {total:,}")
print(f"  With channel_text: {total:,} (all)")
print(f"  With video1_text:  {has_video1:,}")
print(f"  With video2_text:  {has_video2:,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Embedding UDF
# MAGIC
# MAGIC We use the same Foundation Model API as v1. The UDF handles batching internally
# MAGIC and returns zero-vectors for empty/null text to maintain consistent array shapes.

# COMMAND ----------

@pandas_udf(ArrayType(FloatType()))
def generate_embeddings(texts: pd.Series) -> pd.Series:
    """Generate embeddings using Databricks Foundation Model API.
    Returns zero-vectors for empty/null inputs."""
    client = mlflow.deployments.get_deploy_client("databricks")
    results = []
    batch_size = 50
    zero_vec = [0.0] * EMBEDDING_DIMENSION

    for i in range(0, len(texts), batch_size):
        batch = texts.iloc[i:i + batch_size].tolist()

        # Split into real text vs empty/null
        real_indices = []
        real_texts = []
        for j, t in enumerate(batch):
            if t and isinstance(t, str) and t.strip():
                real_indices.append(j)
                real_texts.append(t.strip()[:MAX_TEXT_LENGTH])

        # Initialize all as zero vectors
        batch_results = [zero_vec] * len(batch)

        # Embed only the real texts
        if real_texts:
            try:
                response = client.predict(
                    endpoint=EMBEDDING_MODEL_FMAPI,
                    inputs={"input": real_texts},
                )
                embeddings = [item["embedding"] for item in response["data"]]
                for idx, emb in zip(real_indices, embeddings):
                    batch_results[idx] = emb
            except Exception as e:
                print(f"Error in batch {i}: {e}")

        results.extend(batch_results)

    return pd.Series(results)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Generate Embeddings for All Text Columns
# MAGIC
# MAGIC Embed channel_text (always), video1_text and video2_text (when non-null).
# MAGIC The UDF handles null/empty inputs by returning zero-vectors.

# COMMAND ----------

# Fill nulls with empty string for consistent UDF input
df_embed = (
    df.select("channel_id", "channel_text", "video1_text", "video2_text", "text_input")
    .repartition(50)
)

# Channel embedding (always present)
print("Embedding channel_text...")
df_embed = df_embed.withColumn("channel_embedding", generate_embeddings(col("channel_text")))

# Video embeddings (will be zero-vectors if text is null/empty)
print("Embedding video1_text...")
df_embed = df_embed.withColumn("video1_embedding", generate_embeddings(
    when(col("video1_text").isNotNull() & (col("video1_text") != ""), col("video1_text"))
    .otherwise(lit(""))
))

print("Embedding video2_text...")
df_embed = df_embed.withColumn("video2_embedding", generate_embeddings(
    when(col("video2_text").isNotNull() & (col("video2_text") != ""), col("video2_text"))
    .otherwise(lit(""))
))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Mark Valid Embeddings
# MAGIC
# MAGIC Replace zero-vectors with NULL for video embeddings so the classifier
# MAGIC knows to adjust weights (channel-only mode vs multi-embedding mode).

# COMMAND ----------

def is_zero_vector(col_name):
    """Check if an embedding is all zeros (indicates no real text was embedded)."""
    return F.aggregate(col(col_name), lit(0.0), lambda acc, x: acc + F.abs(x)) == 0.0

df_embed = (
    df_embed
    .withColumn("video1_embedding",
        when(is_zero_vector("video1_embedding"), lit(None))
        .otherwise(col("video1_embedding"))
    )
    .withColumn("video2_embedding",
        when(is_zero_vector("video2_embedding"), lit(None))
        .otherwise(col("video2_embedding"))
    )
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Write v2 Multi-Embedding Table

# COMMAND ----------

embedding_version = f"gte-large-en-v2-{EMBEDDING_DIMENSION}d"

df_v2 = df_embed.select(
    "channel_id",
    "channel_embedding",
    "video1_embedding",
    "video2_embedding",
    lit(embedding_version).alias("embedding_version"),
)

df_v2.write.format("delta").mode("overwrite").saveAsTable(CHANNEL_EMBEDDINGS_V2_TABLE)
print(f"v2 embeddings written to {CHANNEL_EMBEDDINGS_V2_TABLE}")

# COMMAND ----------

# Validate
df_check = spark.table(CHANNEL_EMBEDDINGS_V2_TABLE)
total_v2 = df_check.count()
has_ch = df_check.filter(col("channel_embedding").isNotNull()).count()
has_v1 = df_check.filter(col("video1_embedding").isNotNull()).count()
has_v2 = df_check.filter(col("video2_embedding").isNotNull()).count()

print(f"Total embeddings:        {total_v2:,}")
print(f"  channel_embedding:     {has_ch:,}")
print(f"  video1_embedding:      {has_v1:,}")
print(f"  video2_embedding:      {has_v2:,}")
print(f"  Embedding dim:         {len(df_check.first().channel_embedding)}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Write Legacy Single-Embedding Table
# MAGIC
# MAGIC The Embeddings Explorer app reads `channels_embeddings` with columns
# MAGIC `channel_id`, `text_input`, `embedding`. We populate this with
# MAGIC the channel_embedding for backward compatibility.

# COMMAND ----------

df_legacy = df_embed.select(
    "channel_id",
    "text_input",
    col("channel_embedding").alias("embedding"),
)

df_legacy.write.format("delta").mode("overwrite").saveAsTable(EMBEDDINGS_TABLE)
print(f"Legacy embeddings written to {EMBEDDINGS_TABLE}")
print(f"  Total: {df_legacy.count():,}")

# COMMAND ----------

# Dimension check
df_dim = spark.table(EMBEDDINGS_TABLE)
display(df_dim.select(size("embedding").alias("dim")).limit(5))

zero_count = df_dim.filter(col("embedding").isNull() | (size("embedding") == 0)).count()
print(f"Null/empty embeddings: {zero_count:,}")
