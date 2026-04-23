# Databricks notebook source
# MAGIC %md
# MAGIC # Step 03c: Load 1 — KNN-Blended Classification
# MAGIC
# MAGIC Refine Load 0 results by adding empirical signal from K-nearest neighbors.
# MAGIC
# MAGIC ## How It Works
# MAGIC
# MAGIC 1. For each channel, find the K nearest neighbors in the KNN reference pool
# MAGIC    (high-confidence L0 channels)
# MAGIC 2. Compute KNN support for each IAB category:
# MAGIC    `knn_support(k) = sum(similarity_i for neighbors assigned to k) / K`
# MAGIC 3. Blend with L0 score:
# MAGIC    `L1_score(k) = 0.75 * L0_score(k) + 0.25 * knn_support(k)`
# MAGIC 4. Apply same filtering and confidence resolution as L0
# MAGIC
# MAGIC **Input:** `channel_candidates` (L0), `knn_reference_pool`, `channel_embeddings_v2`
# MAGIC **Output:** Updated `channel_candidates` (L1), `channel_final_labels` (L1), legacy `channels_classified`

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

import numpy as np
import pandas as pd
from pyspark.sql import functions as F
from pyspark.sql.functions import col, lit, size, when, current_timestamp
from pyspark.sql.types import (
    ArrayType, FloatType, IntegerType, StringType,
    StructField, StructType,
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Load Data

# COMMAND ----------

df_candidates_l0 = (
    spark.table(CHANNEL_CANDIDATES_TABLE)
    .filter(col("load_version") == "L0")
)

df_pool = spark.table(KNN_REFERENCE_POOL_TABLE)
df_embeddings = spark.table(CHANNEL_EMBEDDINGS_V2_TABLE)
df_iab = spark.table(IAB_EMBEDDINGS_TABLE)
df_taxonomy = spark.table(IAB_TAXONOMY_TABLE)

pool_size = df_pool.count()
channel_count = df_embeddings.count()

print(f"Channels to refine:  {channel_count:,}")
print(f"KNN pool size:       {pool_size:,}")
print(f"L0 candidate rows:   {df_candidates_l0.count():,}")
print(f"KNN K:               {KNN_K}")
print(f"Blend weights:       L0={L1_WEIGHT_L0}, KNN={L1_WEIGHT_KNN}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Prepare KNN Pool for Broadcast
# MAGIC
# MAGIC Collect the reference pool embeddings and category assignments.
# MAGIC For dev/moderate scale this fits in memory.

# COMMAND ----------

pool_rows = df_pool.select("channel_id", "embedding", "assigned_categories").collect()

pool_payload = {
    "channel_ids": [r.channel_id for r in pool_rows],
    "assigned_categories": [r.assigned_categories for r in pool_rows],
    "embeddings": np.array([r.embedding for r in pool_rows], dtype=np.float32),
}

# Pre-normalize pool embeddings
pool_norms = np.linalg.norm(pool_payload["embeddings"], axis=1, keepdims=True)
pool_norms[pool_norms == 0] = 1.0
pool_payload["embeddings_normalized"] = pool_payload["embeddings"] / pool_norms

class _PoolWrapper:
    def __init__(self, value):
        self.value = value

bc_pool = _PoolWrapper(pool_payload)

pool_mem_mb = pool_payload["embeddings"].nbytes / 1024 / 1024
print(f"Pool matrix: {pool_payload['embeddings'].shape} ({pool_mem_mb:.1f} MB)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Prepare L0 Scores Lookup
# MAGIC
# MAGIC Collect L0 candidate scores per channel so the UDF can reference them.

# COMMAND ----------

# Pivot L0 candidates into a dict: channel_id -> {category_id: score}
l0_rows = df_candidates_l0.select("channel_id", "category_id", "score").collect()

l0_scores = {}
for row in l0_rows:
    if row.channel_id not in l0_scores:
        l0_scores[row.channel_id] = {}
    l0_scores[row.channel_id][row.category_id] = float(row.score)

class _L0Wrapper:
    def __init__(self, value):
        self.value = value

bc_l0 = _L0Wrapper(l0_scores)

print(f"L0 scores loaded for {len(l0_scores):,} channels")

# COMMAND ----------

# Also need IAB category info for building output structs
iab_rows = df_iab.select("unique_id", "name", "tier_path").collect()
tier_info = {row.unique_id: row.tier_level for row in df_taxonomy.select("unique_id", "tier_level").collect()}

iab_info = {
    r.unique_id: {
        "name": r.name,
        "tier_path": r.tier_path,
        "tier_level": tier_info.get(r.unique_id, 1),
    }
    for r in iab_rows
}

class _IABWrapper:
    def __init__(self, value):
        self.value = value

bc_iab_info = _IABWrapper(iab_info)

# Build set of all category IDs that appear in pool assignments
all_pool_cats = set()
for cats in pool_payload["assigned_categories"]:
    if cats:
        all_pool_cats.update(cats)
print(f"Distinct categories in pool: {len(all_pool_cats)}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Load 1 Classification (Distributed)

# COMMAND ----------

category_struct = StructType([
    StructField("iab_id", StringType(), False),
    StructField("name", StringType(), False),
    StructField("tier_path", StringType(), False),
    StructField("tier_level", IntegerType(), False),
    StructField("similarity", FloatType(), False),
])

result_struct = StructType([
    StructField("categories", ArrayType(category_struct), False),
    StructField("confidence_bucket", StringType(), False),
])

from pyspark.sql.functions import pandas_udf

@pandas_udf(result_struct)
def classify_l1_udf(
    channel_ids: pd.Series,
    channel_embs: pd.Series,
) -> pd.DataFrame:
    """
    Load 1: Blend L0 scores with KNN support.

    For each channel:
    1. Find K nearest neighbors from the reference pool
    2. Compute knn_support for each category in L0 candidates
    3. Blend: L1_score = 0.75 * L0_score + 0.25 * knn_support
    4. Apply same filtering and confidence resolution as L0
    """
    pool = bc_pool.value
    pool_normed = pool["embeddings_normalized"]  # (pool_size, 1024)
    pool_cats = pool["assigned_categories"]

    l0 = bc_l0.value
    iab = bc_iab_info.value

    w_l0 = L1_WEIGHT_L0
    w_knn = L1_WEIGHT_KNN
    k = KNN_K
    top_n = L0_TOP_CANDIDATES
    score_thresh = L0_SCORE_THRESHOLD
    score_gap_limit = L0_SCORE_GAP
    winner_gap = L0_STRONG_WINNER_GAP
    max_labels = L0_MAX_LABELS

    all_categories = []
    all_buckets = []

    for idx in range(len(channel_ids)):
        ch_id = channel_ids.iloc[idx]
        ch_emb = channel_embs.iloc[idx]

        # Get L0 scores for this channel
        ch_l0_scores = l0.get(ch_id, {})

        if ch_emb is None or not ch_l0_scores:
            # No embedding or no L0 scores — keep as uncertain
            all_categories.append([])
            all_buckets.append("uncertain")
            continue

        # Find K nearest neighbors from pool
        ch_vec = np.array(ch_emb, dtype=np.float32).reshape(1, -1)
        norm = np.linalg.norm(ch_vec)
        if norm == 0:
            all_categories.append([])
            all_buckets.append("uncertain")
            continue

        ch_normed = ch_vec / norm
        sims = (ch_normed @ pool_normed.T)[0]  # (pool_size,)

        # Top K neighbors
        top_k_idx = np.argsort(sims)[-k:][::-1]

        # Compute KNN support: for each category, sum similarity of neighbors assigned to it
        knn_support = {}
        for ni in top_k_idx:
            neighbor_sim = float(sims[ni])
            neighbor_cats = pool_cats[ni]
            if neighbor_cats:
                for cat_id in neighbor_cats:
                    knn_support[cat_id] = knn_support.get(cat_id, 0.0) + neighbor_sim

        # Normalize KNN support by K to keep it in [0, 1] range
        for cat_id in knn_support:
            knn_support[cat_id] /= k

        # Blend L0 + KNN for all categories that appear in either source
        all_cat_ids = set(ch_l0_scores.keys()) | set(knn_support.keys())
        blended = {}
        for cat_id in all_cat_ids:
            l0_score = ch_l0_scores.get(cat_id, 0.0)
            knn_score = knn_support.get(cat_id, 0.0)
            blended[cat_id] = w_l0 * l0_score + w_knn * knn_score

        # Sort by blended score and take top N
        sorted_cats = sorted(blended.items(), key=lambda x: x[1], reverse=True)[:top_n]

        if not sorted_cats:
            all_categories.append([])
            all_buckets.append("uncertain")
            continue

        best_score = sorted_cats[0][1]

        # Filter: score >= threshold AND score >= best - gap
        candidates = []
        for cat_id, score in sorted_cats:
            if score >= score_thresh and score >= best_score - score_gap_limit:
                info = iab.get(cat_id, {"name": cat_id, "tier_path": "", "tier_level": 1})
                candidates.append((
                    cat_id,
                    info["name"],
                    info["tier_path"],
                    int(info["tier_level"]),
                    float(score),
                ))

        # Confidence resolution (same as L0)
        if len(candidates) == 0:
            all_categories.append([])
            all_buckets.append("uncertain")
        elif len(candidates) >= 2 and (candidates[0][4] - candidates[1][4]) > winner_gap:
            all_categories.append([candidates[0]])
            all_buckets.append("high")
        else:
            all_categories.append(candidates[:max_labels])
            all_buckets.append("medium" if candidates else "uncertain")

    return pd.DataFrame({
        "categories": all_categories,
        "confidence_bucket": all_buckets,
    })

# COMMAND ----------

# Apply L1 classification
df_l1 = (
    df_embeddings
    .select("channel_id", "channel_embedding")
    .repartition(50)
    .withColumn(
        "_result",
        classify_l1_udf(col("channel_id"), col("channel_embedding"))
    )
    .withColumn("categories", col("_result.categories"))
    .withColumn("confidence_bucket", col("_result.confidence_bucket"))
    .drop("_result")
)

# Extract primary category
df_l1 = (
    df_l1
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
# MAGIC ## 5. Validate Results

# COMMAND ----------

total = df_l1.count()
categorized = df_l1.filter(col("num_categories") > 0).count()
uncategorized = total - categorized

print(f"Load 1 Results:")
print(f"  Total channels:    {total:,}")
print(f"  Categorized:       {categorized:,} ({categorized/total*100:.1f}%)")
print(f"  Uncategorized:     {uncategorized:,} ({uncategorized/total*100:.1f}%)")

# COMMAND ----------

print("L1 Confidence bucket distribution:")
display(
    df_l1
    .groupBy("confidence_bucket")
    .agg(
        F.count("*").alias("channels"),
        F.round(F.avg("primary_confidence"), 3).alias("avg_primary_score"),
        F.round(F.avg("num_categories"), 1).alias("avg_labels"),
    )
    .orderBy("confidence_bucket")
)

# COMMAND ----------

# Compare L0 vs L1 bucket distribution
df_l0_labels = spark.table(CHANNEL_FINAL_LABELS_TABLE).filter(col("load_version") == "L0")

print("L0 → L1 Confidence Shift:")
df_compare = (
    df_l0_labels.select(
        "channel_id",
        col("confidence_bucket").alias("l0_bucket"),
    )
    .join(
        df_l1.select("channel_id", col("confidence_bucket").alias("l1_bucket")),
        on="channel_id",
        how="inner",
    )
)
display(
    df_compare
    .groupBy("l0_bucket", "l1_bucket")
    .count()
    .orderBy("l0_bucket", "l1_bucket")
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Write Results

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6a. Write L1 candidates

# COMMAND ----------

from pyspark.sql.functions import posexplode

df_candidates_l1 = (
    df_l1
    .select("channel_id", posexplode("categories").alias("rank", "cat"))
    .select(
        "channel_id",
        col("cat.iab_id").alias("category_id"),
        col("cat.name").alias("category_name"),
        col("cat.tier_path").alias("tier_path"),
        col("cat.similarity").alias("score"),
        (col("rank") + 1).cast("int").alias("rank"),
        lit("L1").alias("load_version"),
    )
)

# Append L1 to candidates (keep L0 rows, add L1 rows)
df_existing = spark.table(CHANNEL_CANDIDATES_TABLE).filter(col("load_version") == "L0")
df_all_candidates = df_existing.unionByName(df_candidates_l1)
df_all_candidates.write.format("delta").mode("overwrite").saveAsTable(CHANNEL_CANDIDATES_TABLE)
print(f"Candidates updated: L0 + L1 = {df_all_candidates.count():,} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6b. Write L1 final labels

# COMMAND ----------

df_l1_labels = (
    df_l1
    .select(
        "channel_id",
        F.transform(col("categories"), lambda x: x["iab_id"]).alias("aboutness_labels"),
        F.transform(col("categories"), lambda x: x["name"]).alias("aboutness_names"),
        F.transform(col("categories"), lambda x: x["similarity"]).alias("scores"),
        "confidence_bucket",
        lit("L1").alias("load_version"),
        "primary_category",
        col("primary_confidence").alias("primary_score"),
    )
)

# Append L1 to labels (keep L0 rows, add L1 rows)
df_existing_labels = spark.table(CHANNEL_FINAL_LABELS_TABLE).filter(col("load_version") == "L0")
df_all_labels = df_existing_labels.unionByName(df_l1_labels)
df_all_labels.write.format("delta").mode("overwrite").saveAsTable(CHANNEL_FINAL_LABELS_TABLE)
print(f"Final labels updated: L0 + L1 = {df_all_labels.count():,} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6c. Update legacy channels_classified with L1 results

# COMMAND ----------

df_legacy = (
    df_l1
    .join(
        df_embeddings.select("channel_id", "channel_embedding"),
        on="channel_id",
        how="inner",
    )
    .select(
        "channel_id",
        "channel_embedding",
        "categories",
        "primary_category",
        "primary_tier_path",
        "primary_confidence",
        "num_categories",
        "confidence_bucket",
    )
)

df_legacy.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(CLASSIFIED_TABLE)
print(f"Legacy classified updated with L1 results: {df_legacy.count():,} rows")

# COMMAND ----------

# Summary
print("=" * 60)
print(f"Load 1 Classification Complete")
print("=" * 60)
print(f"  Channels:     {total:,}")
print(f"  Categorized:  {categorized:,} ({categorized/total*100:.1f}%)")
print(f"  High:         {df_l1.filter(col('confidence_bucket') == 'high').count():,}")
print(f"  Medium:       {df_l1.filter(col('confidence_bucket') == 'medium').count():,}")
print(f"  Uncertain:    {df_l1.filter(col('confidence_bucket') == 'uncertain').count():,}")
print(f"  KNN pool:     {pool_size:,} reference channels")
print(f"  KNN K:        {KNN_K}")
