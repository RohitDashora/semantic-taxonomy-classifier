# Databricks notebook source
# MAGIC %md
# MAGIC # Step 03b: Build KNN Reference Pool
# MAGIC
# MAGIC Select high-confidence channels from Load 0 results to serve as the
# MAGIC KNN reference pool for Load 1 refinement.
# MAGIC
# MAGIC ## Selection Criteria
# MAGIC
# MAGIC A channel enters the reference pool if:
# MAGIC - `confidence_bucket = "high"` (strong winner in L0), OR
# MAGIC - Top L0 score >= `KNN_POOL_MIN_SCORE` (0.75) AND score gap >= `KNN_POOL_MIN_GAP` (0.10)
# MAGIC
# MAGIC These are channels where L0 classification is highly confident and stable.
# MAGIC
# MAGIC **Input:** `channel_final_labels` (L0) + `channel_embeddings_v2`
# MAGIC **Output:** `knn_reference_pool`

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.functions import col, lit, size

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Load L0 Results

# COMMAND ----------

df_labels = (
    spark.table(CHANNEL_FINAL_LABELS_TABLE)
    .filter(col("load_version") == "L0")
)

total = df_labels.count()
print(f"Total L0 labeled channels: {total:,}")
print(f"  High:      {df_labels.filter(col('confidence_bucket') == 'high').count():,}")
print(f"  Medium:    {df_labels.filter(col('confidence_bucket') == 'medium').count():,}")
print(f"  Uncertain: {df_labels.filter(col('confidence_bucket') == 'uncertain').count():,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Select Pool Candidates
# MAGIC
# MAGIC High-confidence channels: those with strong winner OR high primary score with clear gap.

# COMMAND ----------

# Extract top score and gap from the scores array
df_with_stats = (
    df_labels
    .withColumn("top_score", col("scores")[0])
    .withColumn("second_score",
        F.when(size(col("scores")) >= 2, col("scores")[1]).otherwise(lit(0.0))
    )
    .withColumn("score_gap", col("top_score") - col("second_score"))
)

# Select pool candidates
df_pool_candidates = df_with_stats.filter(
    (col("confidence_bucket") == "high")
    | (
        (col("top_score") >= KNN_POOL_MIN_SCORE)
        & (col("score_gap") >= KNN_POOL_MIN_GAP)
    )
)

pool_size = df_pool_candidates.count()
print(f"KNN pool candidates: {pool_size:,} ({pool_size/total*100:.1f}% of all channels)")
print(f"  Selection criteria:")
print(f"    confidence_bucket = 'high' OR")
print(f"    (top_score >= {KNN_POOL_MIN_SCORE} AND score_gap >= {KNN_POOL_MIN_GAP})")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Join with Embeddings

# COMMAND ----------

df_embeddings = spark.table(CHANNEL_EMBEDDINGS_V2_TABLE).select(
    "channel_id",
    col("channel_embedding").alias("embedding"),
)

df_pool = (
    df_pool_candidates
    .select(
        "channel_id",
        "aboutness_labels",
        col("top_score").alias("confidence_score"),
    )
    .join(df_embeddings, on="channel_id", how="inner")
    .select(
        "channel_id",
        "embedding",
        col("aboutness_labels").alias("assigned_categories"),
        "confidence_score",
    )
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Validate & Write

# COMMAND ----------

final_pool_size = df_pool.count()
print(f"KNN reference pool: {final_pool_size:,} channels")
print(f"  Avg confidence: {df_pool.agg(F.avg('confidence_score')).first()[0]:.3f}")
print(f"  Min confidence: {df_pool.agg(F.min('confidence_score')).first()[0]:.3f}")

# Category distribution in pool
df_pool_exploded = df_pool.select(F.explode("assigned_categories").alias("cat_id"))
print(f"  Distinct categories in pool: {df_pool_exploded.distinct().count()}")

# COMMAND ----------

df_pool.write.format("delta").mode("overwrite").saveAsTable(KNN_REFERENCE_POOL_TABLE)
print(f"KNN reference pool written to {KNN_REFERENCE_POOL_TABLE}")
print(f"  Pool size: {final_pool_size:,}")
print(f"  Embedding dim: {len(df_pool.first().embedding)}")
