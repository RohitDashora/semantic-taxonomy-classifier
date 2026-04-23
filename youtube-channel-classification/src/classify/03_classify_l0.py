# Databricks notebook source
# MAGIC %md
# MAGIC # Step 03 (v2): Load 0 — Weighted Multi-Embedding Classification
# MAGIC
# MAGIC Classify each channel into IAB Content Taxonomy categories using **weighted
# MAGIC cosine similarity** across up to 3 embeddings per channel.
# MAGIC
# MAGIC ## Scoring Formula
# MAGIC
# MAGIC ```
# MAGIC score(k) = w_ch * cos(channel, iab_k) + w_v1 * cos(video1, iab_k) + w_v2 * cos(video2, iab_k)
# MAGIC ```
# MAGIC
# MAGIC Weights adapt based on available embeddings:
# MAGIC - All 3: 0.4 / 0.3 / 0.3
# MAGIC - Channel + 1 video: 0.55 / 0.45
# MAGIC - Channel only: 1.0
# MAGIC
# MAGIC ## Filtering
# MAGIC
# MAGIC 1. Top 10 candidates by score
# MAGIC 2. Filter: `score >= 0.62 AND score >= best_score - 0.12`
# MAGIC 3. Confidence resolution:
# MAGIC    - Strong winner (gap > 0.08): publish 1 label → "high"
# MAGIC    - Multi-label (passes filter): publish up to 3 → "medium"
# MAGIC    - Nothing passes: "uncertain"
# MAGIC
# MAGIC **Input:** `channel_embeddings_v2` + `iab_taxonomy_embeddings`
# MAGIC **Output:** `channel_candidates`, `channel_final_labels`, legacy `channels_classified`

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

df_channels = spark.table(CHANNEL_EMBEDDINGS_V2_TABLE)
df_iab = spark.table(IAB_EMBEDDINGS_TABLE)
df_taxonomy = spark.table(IAB_TAXONOMY_TABLE)

channel_count = df_channels.count()
iab_count = df_iab.count()

print(f"Channel embeddings (v2): {channel_count:,}")
print(f"IAB categories:          {iab_count}")
print(f"L0 score threshold:      {L0_SCORE_THRESHOLD}")
print(f"L0 score gap:            {L0_SCORE_GAP}")
print(f"L0 strong winner gap:    {L0_STRONG_WINNER_GAP}")
print(f"L0 max labels:           {L0_MAX_LABELS}")
print(f"Weights:                 ch={L0_WEIGHT_CHANNEL} v1={L0_WEIGHT_VIDEO1} v2={L0_WEIGHT_VIDEO2}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Prepare IAB Category Vectors
# MAGIC
# MAGIC Same broadcast approach as v1 — 698 categories × 1024 dims = ~2.7 MB.

# COMMAND ----------

iab_rows = df_iab.select("unique_id", "name", "tier_path", "embedding").collect()

tier_info = {
    row.unique_id: row.tier_level
    for row in df_taxonomy.select("unique_id", "tier_level").collect()
}

iab_payload = {
    "ids": [r.unique_id for r in iab_rows],
    "names": [r.name for r in iab_rows],
    "tier_paths": [r.tier_path for r in iab_rows],
    "tier_levels": [tier_info.get(r.unique_id, 1) for r in iab_rows],
    "embeddings": np.array([r.embedding for r in iab_rows], dtype=np.float32),
}

# Pre-normalize IAB vectors
norms = np.linalg.norm(iab_payload["embeddings"], axis=1, keepdims=True)
norms[norms == 0] = 1.0
iab_payload["embeddings_normalized"] = iab_payload["embeddings"] / norms

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
# MAGIC ## 3. Classify Channels — Load 0 (Distributed)
# MAGIC
# MAGIC The pandas_udf receives 3 embedding columns per channel and computes
# MAGIC weighted cosine similarity against all 698 IAB categories.

# COMMAND ----------

# Output schema for the categories array (same as v1 for legacy compat)
category_struct = StructType([
    StructField("iab_id", StringType(), False),
    StructField("name", StringType(), False),
    StructField("tier_path", StringType(), False),
    StructField("tier_level", IntegerType(), False),
    StructField("similarity", FloatType(), False),
])

# Result schema: categories array + confidence_bucket
result_struct = StructType([
    StructField("categories", ArrayType(category_struct), False),
    StructField("confidence_bucket", StringType(), False),
])

from pyspark.sql.functions import pandas_udf

@pandas_udf(result_struct)
def classify_l0_udf(
    channel_embs: pd.Series,
    video1_embs: pd.Series,
    video2_embs: pd.Series,
) -> pd.DataFrame:
    """
    Load 0: Weighted multi-embedding classification.

    For each channel:
    1. Compute cosine similarity for each available embedding against IAB categories
    2. Combine with adaptive weights
    3. Select top candidates, apply threshold + gap filter
    4. Determine confidence bucket (high / medium / uncertain)
    """
    iab = bc_iab.value
    iab_normed = iab["embeddings_normalized"]  # (698, 1024)

    # Config values captured in closure
    w_ch = L0_WEIGHT_CHANNEL
    w_v1 = L0_WEIGHT_VIDEO1
    w_v2 = L0_WEIGHT_VIDEO2
    top_n = L0_TOP_CANDIDATES
    score_thresh = L0_SCORE_THRESHOLD
    score_gap = L0_SCORE_GAP
    winner_gap = L0_STRONG_WINNER_GAP
    max_labels = L0_MAX_LABELS

    all_categories = []
    all_buckets = []

    for idx in range(len(channel_embs)):
        ch_emb = channel_embs.iloc[idx]
        v1_emb = video1_embs.iloc[idx]
        v2_emb = video2_embs.iloc[idx]

        # Parse embeddings — determine which are available
        ch_vec = np.array(ch_emb, dtype=np.float32).reshape(1, -1) if ch_emb is not None else None
        v1_vec = np.array(v1_emb, dtype=np.float32).reshape(1, -1) if v1_emb is not None else None
        v2_vec = np.array(v2_emb, dtype=np.float32).reshape(1, -1) if v2_emb is not None else None

        if ch_vec is None or np.linalg.norm(ch_vec) == 0:
            all_categories.append([])
            all_buckets.append("uncertain")
            continue

        # Normalize channel vector
        ch_normed = ch_vec / np.linalg.norm(ch_vec)
        sim_ch = (ch_normed @ iab_normed.T)[0]  # (698,)

        # Compute video similarities if available
        has_v1 = v1_vec is not None and np.linalg.norm(v1_vec) > 0
        has_v2 = v2_vec is not None and np.linalg.norm(v2_vec) > 0

        if has_v1 and has_v2:
            # All 3 embeddings: use configured weights
            v1_normed = v1_vec / np.linalg.norm(v1_vec)
            v2_normed = v2_vec / np.linalg.norm(v2_vec)
            sim_v1 = (v1_normed @ iab_normed.T)[0]
            sim_v2 = (v2_normed @ iab_normed.T)[0]
            scores = w_ch * sim_ch + w_v1 * sim_v1 + w_v2 * sim_v2
        elif has_v1:
            # Channel + 1 video
            v1_normed = v1_vec / np.linalg.norm(v1_vec)
            sim_v1 = (v1_normed @ iab_normed.T)[0]
            scores = 0.55 * sim_ch + 0.45 * sim_v1
        elif has_v2:
            # Channel + 1 video (video2 only, unlikely but handle it)
            v2_normed = v2_vec / np.linalg.norm(v2_vec)
            sim_v2 = (v2_normed @ iab_normed.T)[0]
            scores = 0.55 * sim_ch + 0.45 * sim_v2
        else:
            # Channel only
            scores = sim_ch

        # Step 1: Top N candidates
        top_idx = np.argsort(scores)[-top_n:][::-1]
        best_score = float(scores[top_idx[0]])

        # Step 2: Filter — score >= threshold AND score >= best - gap
        candidates = []
        for i in top_idx:
            s = float(scores[i])
            if s >= score_thresh and s >= best_score - score_gap:
                candidates.append((
                    iab["ids"][i],
                    iab["names"][i],
                    iab["tier_paths"][i],
                    int(iab["tier_levels"][i]),
                    s,
                ))

        # Step 3: Confidence resolution
        if len(candidates) == 0:
            all_categories.append([])
            all_buckets.append("uncertain")
        elif len(candidates) >= 2 and (candidates[0][4] - candidates[1][4]) > winner_gap:
            # Strong winner — publish only 1
            all_categories.append([candidates[0]])
            all_buckets.append("high")
        else:
            # Multi-label — publish up to max_labels
            all_categories.append(candidates[:max_labels])
            if len(candidates) > 0:
                all_buckets.append("medium")
            else:
                all_buckets.append("uncertain")

    return pd.DataFrame({
        "categories": all_categories,
        "confidence_bucket": all_buckets,
    })

# COMMAND ----------

# Apply classification
df_classified = (
    df_channels
    .repartition(50)
    .withColumn(
        "_result",
        classify_l0_udf(
            col("channel_embedding"),
            col("video1_embedding"),
            col("video2_embedding"),
        )
    )
    .withColumn("categories", col("_result.categories"))
    .withColumn("confidence_bucket", col("_result.confidence_bucket"))
    .drop("_result")
)

# Extract primary category
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

# Confidence bucket distribution
print("Confidence bucket distribution:")
display(
    df_classified
    .groupBy("confidence_bucket")
    .agg(
        F.count("*").alias("channels"),
        F.round(F.avg("primary_confidence"), 3).alias("avg_primary_score"),
        F.round(F.avg("num_categories"), 1).alias("avg_labels"),
    )
    .orderBy("confidence_bucket")
)

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

# Sample channels
display(
    df_classified.select(
        "channel_id",
        "primary_category",
        F.round("primary_confidence", 3).alias("confidence"),
        "confidence_bucket",
        "num_categories",
        F.transform(
            F.slice("categories", 1, 5),
            lambda x: F.concat(x["name"], lit(" ("), F.round(x["similarity"], 2).cast("string"), lit(")"))
        ).alias("top_categories"),
    ).limit(20)
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Write Results

# COMMAND ----------

# MAGIC %md
# MAGIC ### 5a. Write channel_candidates (new v2 table)

# COMMAND ----------

from pyspark.sql.functions import explode, posexplode

df_candidates = (
    df_classified
    .select("channel_id", posexplode("categories").alias("rank", "cat"))
    .select(
        "channel_id",
        col("cat.iab_id").alias("category_id"),
        col("cat.name").alias("category_name"),
        col("cat.tier_path").alias("tier_path"),
        col("cat.similarity").alias("score"),
        (col("rank") + 1).cast("int").alias("rank"),
        lit("L0").alias("load_version"),
    )
)

df_candidates.write.format("delta").mode("overwrite").saveAsTable(CHANNEL_CANDIDATES_TABLE)
print(f"Candidates written to {CHANNEL_CANDIDATES_TABLE}: {df_candidates.count():,} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 5b. Write channel_final_labels (new v2 table)

# COMMAND ----------

df_labels = (
    df_classified
    .select(
        "channel_id",
        F.transform(col("categories"), lambda x: x["iab_id"]).alias("aboutness_labels"),
        F.transform(col("categories"), lambda x: x["name"]).alias("aboutness_names"),
        F.transform(col("categories"), lambda x: x["similarity"]).alias("scores"),
        "confidence_bucket",
        lit("L0").alias("load_version"),
        "primary_category",
        col("primary_confidence").alias("primary_score"),
    )
)

df_labels.write.format("delta").mode("overwrite").saveAsTable(CHANNEL_FINAL_LABELS_TABLE)
print(f"Final labels written to {CHANNEL_FINAL_LABELS_TABLE}: {df_labels.count():,} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 5c. Write legacy channels_classified (backward compat)

# COMMAND ----------

df_legacy = df_classified.select(
    "channel_id",
    "channel_embedding",
    "categories",
    "primary_category",
    "primary_tier_path",
    "primary_confidence",
    "num_categories",
    "confidence_bucket",
)

df_legacy.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(CLASSIFIED_TABLE)
print(f"Legacy classified written to {CLASSIFIED_TABLE}: {total:,} rows")

# COMMAND ----------

# Summary
print("=" * 60)
print(f"Load 0 Classification Complete")
print("=" * 60)
print(f"  Channels:     {total:,}")
print(f"  Categorized:  {categorized:,} ({categorized/total*100:.1f}%)")
print(f"  High:         {df_classified.filter(col('confidence_bucket') == 'high').count():,}")
print(f"  Medium:       {df_classified.filter(col('confidence_bucket') == 'medium').count():,}")
print(f"  Uncertain:    {df_classified.filter(col('confidence_bucket') == 'uncertain').count():,}")
print(f"  Avg labels:   {df_classified.agg(F.avg('num_categories')).first()[0]:.1f}")
