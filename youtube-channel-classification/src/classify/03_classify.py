# Databricks notebook source
# MAGIC %md
# MAGIC # Step 03: Multi-Label Classification (IAB Taxonomy)
# MAGIC
# MAGIC Classify each channel into multiple IAB Content Taxonomy categories using
# MAGIC cosine similarity between channel embeddings and IAB category embeddings.
# MAGIC
# MAGIC ## How It Works
# MAGIC
# MAGIC 1. Load pre-computed channel embeddings (1024-dim vectors)
# MAGIC 2. Load IAB taxonomy embeddings (698 category vectors, same dimension)
# MAGIC 3. For each channel, compute cosine similarity against ALL categories
# MAGIC 4. Assign all categories above a threshold (default 0.3), capped at 10
# MAGIC 5. The highest-scoring category becomes the primary category
# MAGIC
# MAGIC This is **multi-label**: a channel can belong to Sports AND Entertainment.
# MAGIC
# MAGIC ## Scalability
# MAGIC
# MAGIC - IAB category embeddings (698 × 1024 = ~2.7 MB) are broadcast to all workers
# MAGIC - Each Spark partition independently computes similarity for its channels
# MAGIC - No data is collected to the driver — fully distributed via `pandas_udf`
# MAGIC
# MAGIC **Input:** Channel embeddings table + IAB taxonomy embeddings table
# MAGIC **Output:** Classified channels table with multi-label categories

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

import numpy as np
import pandas as pd
from pyspark.sql import functions as F
from pyspark.sql.functions import col, lit, size, when
from pyspark.sql.types import (
    ArrayType, FloatType, IntegerType, StringType,
    StructField, StructType,
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Load Data

# COMMAND ----------

df_channels = spark.table(EMBEDDINGS_TABLE)
df_iab = spark.table(IAB_EMBEDDINGS_TABLE)
df_taxonomy = spark.table(IAB_TAXONOMY_TABLE)

channel_count = df_channels.count()
iab_count = df_iab.count()

print(f"Channel embeddings: {channel_count:,}")
print(f"IAB categories:     {iab_count}")
print(f"Similarity threshold: {SIMILARITY_THRESHOLD}")
print(f"Max categories/channel: {MAX_CATEGORIES_PER_CHANNEL}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Prepare IAB Category Vectors
# MAGIC
# MAGIC Collect the 698 IAB category embeddings and broadcast them to all Spark
# MAGIC workers. At ~2.7 MB this fits easily in memory on every executor.

# COMMAND ----------

# Collect IAB data (small — 698 rows)
iab_rows = df_iab.select("unique_id", "name", "tier_path", "embedding").collect()

# Also get tier metadata for filtering
tier_info = {
    row.unique_id: row.tier_level
    for row in df_taxonomy.select("unique_id", "tier_level").collect()
}

# Build broadcast payload
iab_payload = {
    "ids": [r.unique_id for r in iab_rows],
    "names": [r.name for r in iab_rows],
    "tier_paths": [r.tier_path for r in iab_rows],
    "tier_levels": [tier_info.get(r.unique_id, 1) for r in iab_rows],
    "embeddings": np.array([r.embedding for r in iab_rows], dtype=np.float32),
}

# Pre-normalize IAB vectors for faster cosine similarity
norms = np.linalg.norm(iab_payload["embeddings"], axis=1, keepdims=True)
norms[norms == 0] = 1.0  # avoid division by zero
iab_payload["embeddings_normalized"] = iab_payload["embeddings"] / norms

# Wrap payload to match broadcast variable interface (bc_iab.value)
# Closure capture serializes this to workers — fine for ~2.7 MB
class _BroadcastWrapper:
    def __init__(self, value):
        self.value = value

bc_iab = _BroadcastWrapper(iab_payload)

print(f"IAB matrix: {iab_payload['embeddings'].shape}")
print(f"  Tier 1: {sum(1 for t in iab_payload['tier_levels'] if t == 1)}")
print(f"  Tier 2: {sum(1 for t in iab_payload['tier_levels'] if t == 2)}")
print(f"  Tier 3: {sum(1 for t in iab_payload['tier_levels'] if t == 3)}")
print(f"  Tier 4: {sum(1 for t in iab_payload['tier_levels'] if t == 4)}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Classify Channels (Distributed)
# MAGIC
# MAGIC ### How Cosine Similarity Works
# MAGIC
# MAGIC Each channel and each IAB category is represented as a 1024-dimensional
# MAGIC vector (embedding). Cosine similarity measures the angle between two vectors:
# MAGIC
# MAGIC ```
# MAGIC similarity(A, B) = dot(A, B) / (||A|| × ||B||)
# MAGIC ```
# MAGIC
# MAGIC Values range from -1 (opposite) to +1 (identical meaning).
# MAGIC
# MAGIC For each channel we compute similarity against all 698 IAB categories,
# MAGIC then keep those above the threshold. This is a simple matrix multiply
# MAGIC that runs efficiently on each Spark partition.

# COMMAND ----------

# Define output schema for the categories array
category_struct = StructType([
    StructField("iab_id", StringType(), False),
    StructField("name", StringType(), False),
    StructField("tier_path", StringType(), False),
    StructField("tier_level", IntegerType(), False),
    StructField("similarity", FloatType(), False),
])

from pyspark.sql.functions import pandas_udf

@pandas_udf(ArrayType(category_struct))
def classify_channels_udf(embeddings: pd.Series) -> pd.Series:
    """
    Classify channels by cosine similarity to IAB category embeddings.

    For each channel embedding:
    1. Normalize the channel vector
    2. Dot product with pre-normalized IAB matrix → cosine similarities
    3. Filter by threshold, sort by similarity, cap at max categories
    """
    iab = bc_iab.value
    iab_normed = iab["embeddings_normalized"]  # (698, 1024) pre-normalized
    threshold = SIMILARITY_THRESHOLD
    max_cats = MAX_CATEGORIES_PER_CHANNEL

    results = []
    for emb in embeddings:
        vec = np.array(emb, dtype=np.float32).reshape(1, -1)

        # Normalize channel vector
        norm = np.linalg.norm(vec)
        if norm == 0:
            results.append([])
            continue
        vec_normed = vec / norm

        # Cosine similarity: dot product of normalized vectors
        sims = (vec_normed @ iab_normed.T)[0]  # shape: (698,)

        # Filter above threshold and build results
        above = []
        for i in range(len(sims)):
            if sims[i] >= threshold:
                above.append((
                    iab["ids"][i],
                    iab["names"][i],
                    iab["tier_paths"][i],
                    int(iab["tier_levels"][i]),
                    float(sims[i]),
                ))

        # Sort by similarity descending, cap at max
        above.sort(key=lambda x: x[4], reverse=True)
        results.append(above[:max_cats])

    return pd.Series(results)

# COMMAND ----------

# Apply classification
df_classified = (
    df_channels
    .repartition(50)
    .withColumn("categories", classify_channels_udf(col("embedding")))
)

# Extract primary category (highest similarity)
df_classified = (
    df_classified
    .withColumn("primary_category",
        when(size(col("categories")) > 0, col("categories")[0]["name"])
        .otherwise(lit("Uncategorized"))
    )
    .withColumn("primary_tier_path",
        when(size(col("categories")) > 0, col("categories")[0]["tier_path"])
    )
    .withColumn("primary_confidence",
        when(size(col("categories")) > 0, col("categories")[0]["similarity"])
        .otherwise(lit(0.0))
    )
    .withColumn("num_categories", size(col("categories")))
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Validate Results

# COMMAND ----------

total = df_classified.count()
categorized = df_classified.filter(col("num_categories") > 0).count()
uncategorized = total - categorized

print(f"Total channels:    {total:,}")
print(f"Categorized:       {categorized:,} ({categorized/total*100:.1f}%)")
print(f"Uncategorized:     {uncategorized:,} ({uncategorized/total*100:.1f}%)")

# COMMAND ----------

# Category count distribution
print("Categories per channel distribution:")
display(
    df_classified
    .groupBy("num_categories")
    .count()
    .orderBy("num_categories")
)

# COMMAND ----------

# Top primary categories
print("Top primary categories:")
display(
    df_classified
    .groupBy("primary_category")
    .agg(
        F.count("*").alias("channels"),
        F.round(F.avg("primary_confidence"), 3).alias("avg_confidence"),
    )
    .orderBy(F.desc("channels"))
    .limit(30)
)

# COMMAND ----------

# Sample channels with their categories
display(
    df_classified.select(
        "channel_id",
        "primary_category",
        F.round("primary_confidence", 3).alias("confidence"),
        "num_categories",
        F.transform(
            F.slice("categories", 1, 5),
            lambda x: F.concat(x["name"], lit(" ("), F.round(x["similarity"], 2).cast("string"), lit(")"))
        ).alias("top_5_categories"),
    ).limit(20)
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Save Results

# COMMAND ----------

df_classified.write.format("delta").mode("overwrite").saveAsTable(CLASSIFIED_TABLE)
print(f"Saved classified channels to {CLASSIFIED_TABLE}")
print(f"  Total: {total:,}")
print(f"  Categorized: {categorized:,}")
print(f"  Avg categories/channel: {df_classified.agg(F.avg('num_categories')).first()[0]:.1f}")
