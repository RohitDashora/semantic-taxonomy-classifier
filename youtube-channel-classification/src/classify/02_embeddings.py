# Databricks notebook source
# MAGIC %md
# MAGIC # Step 02: Embedding Generation
# MAGIC
# MAGIC Generate vector embeddings for each channel's `text_input`.
# MAGIC
# MAGIC **Option A:** Foundation Model API (`ai_query`) — no GPU needed
# MAGIC **Option B:** Self-hosted `sentence-transformers` — GPU cluster required
# MAGIC
# MAGIC **Input:** Prepped channels table (from step 01)
# MAGIC **Output:** Embeddings table with `channel_id` + `embedding`

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

df = spark.table(PREPPED_TABLE)
total = df.count()
print(f"Channels to embed: {total:,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Option A: Foundation Model API

# COMMAND ----------

if USE_FOUNDATION_MODEL_API:
    import mlflow.deployments
    import pandas as pd
    import numpy as np
    from pyspark.sql.functions import col, pandas_udf
    from pyspark.sql.types import ArrayType, FloatType

    @pandas_udf(ArrayType(FloatType()))
    def generate_embeddings_fmapi(texts: pd.Series) -> pd.Series:
        """Generate embeddings using Databricks Foundation Model API."""
        client = mlflow.deployments.get_deploy_client("databricks")
        results = []
        batch_size = 50

        for i in range(0, len(texts), batch_size):
            batch = texts.iloc[i:i + batch_size].fillna("").tolist()
            try:
                response = client.predict(
                    endpoint=EMBEDDING_MODEL_FMAPI,
                    inputs={"input": batch},
                )
                embeddings = [item["embedding"] for item in response["data"]]
                results.extend(embeddings)
            except Exception as e:
                print(f"Error in batch {i}: {e}")
                results.extend([[0.0] * EMBEDDING_DIMENSION] * len(batch))

        return pd.Series(results)

    df_embedded = (
        df.select("channel_id", "text_input")
        .repartition(50)
        .withColumn("embedding", generate_embeddings_fmapi(col("text_input")))
    )

# COMMAND ----------

# MAGIC %md
# MAGIC ## Option B: sentence-transformers (GPU)

# COMMAND ----------

if not USE_FOUNDATION_MODEL_API:
    # %pip install sentence-transformers torch
    from sentence_transformers import SentenceTransformer
    import pandas as pd
    from pyspark.sql.functions import col, pandas_udf
    from pyspark.sql.types import ArrayType, FloatType

    @pandas_udf(ArrayType(FloatType()))
    def generate_embeddings_hf(texts: pd.Series) -> pd.Series:
        """Generate embeddings using local sentence-transformers model."""
        model = SentenceTransformer(EMBEDDING_MODEL_HF)
        clean_texts = texts.fillna("").tolist()
        embeddings = model.encode(
            clean_texts, batch_size=256,
            show_progress_bar=False, normalize_embeddings=True,
        )
        return pd.Series([emb.tolist() for emb in embeddings])

    df_embedded = (
        df.select("channel_id", "text_input")
        .repartition(100)
        .withColumn("embedding", generate_embeddings_hf(col("text_input")))
    )

# COMMAND ----------

# MAGIC %md
# MAGIC ## Write Embeddings

# COMMAND ----------

df_embedded.write.format("delta").mode("overwrite").saveAsTable(EMBEDDINGS_TABLE)
print(f"Embeddings written to {EMBEDDINGS_TABLE}")

# COMMAND ----------

from pyspark.sql.functions import size
df_check = spark.table(EMBEDDINGS_TABLE)
print(f"Total embeddings: {df_check.count():,}")
display(df_check.select(size("embedding").alias("dim")).limit(5))

zero_count = df_check.filter(col("embedding").isNull() | (size("embedding") == 0)).count()
print(f"Null/empty embeddings: {zero_count:,}")
