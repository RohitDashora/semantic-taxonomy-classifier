# Databricks notebook source
# MAGIC %md
# MAGIC # Step 04: Final Output Table
# MAGIC
# MAGIC Produce the final output tables from the multi-label classification results.
# MAGIC
# MAGIC **Two output tables:**
# MAGIC 1. **Nested table** (`channels_output`) — one row per channel, categories as array
# MAGIC 2. **Flat table** (`channels_classification_flat`) — one row per channel-category pair, easy SQL
# MAGIC
# MAGIC **Input:** Classified channels table (from step 03) + prepped table (for metadata)
# MAGIC **Output:** Final Delta tables

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.functions import col, lit, current_timestamp, explode, round as spark_round
from datetime import datetime

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Load & Merge
# MAGIC
# MAGIC Reads from v2 tables (`channel_final_labels`, `channel_candidates`) if available,
# MAGIC falls back to legacy `channels_classified` for backward compat.

# COMMAND ----------

# Determine which load version to use (L1 if available, else L0)
try:
    df_labels = spark.table(CHANNEL_FINAL_LABELS_TABLE)
    has_l1 = df_labels.filter(col("load_version") == "L1").count() > 0
    active_load = "L1" if has_l1 else "L0"
    print(f"[v2] Reading from {CHANNEL_FINAL_LABELS_TABLE}, load_version={active_load}")
    use_v2 = True
except Exception:
    active_load = "v1"
    use_v2 = False
    print("[v1] Falling back to legacy channels_classified")

# COMMAND ----------

df_classified = spark.table(CLASSIFIED_TABLE)
df_prepped = spark.table(PREPPED_TABLE).select(
    COL_CHANNEL_ID, COL_CHANNEL_URL, COL_TITLE, "text_length",
)

# If v2 tables exist, overlay confidence_bucket and load_version from final_labels
if use_v2:
    # Drop confidence_bucket from classified table to avoid ambiguity — final_labels is authoritative
    df_classified = df_classified.drop("confidence_bucket")
    df_final_labels = (
        spark.table(CHANNEL_FINAL_LABELS_TABLE)
        .filter(col("load_version") == active_load)
        .select("channel_id", "confidence_bucket", "load_version")
    )
    df_classified = df_classified.join(df_final_labels, on="channel_id", how="left")
    # Fill in defaults for channels not in v2 labels
    df_classified = (
        df_classified
        .withColumn("confidence_bucket", F.coalesce(col("confidence_bucket"), lit("unknown")))
        .withColumn("load_version", F.coalesce(col("load_version"), lit(active_load)))
    )
else:
    df_classified = (
        df_classified
        .withColumn("confidence_bucket",
            F.when(col("confidence_bucket").isNotNull(), col("confidence_bucket"))
            .otherwise(lit("unknown"))
        )
        .withColumn("load_version", lit("v1"))
    )

df_merged = df_classified.join(df_prepped, on="channel_id", how="inner")
print(f"Merged: {df_merged.count():,} channels (load: {active_load})")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Build Nested Output
# MAGIC
# MAGIC One row per channel with all assigned categories as an array.

# COMMAND ----------

model_version = f"v2.0_iab_{datetime.now().strftime('%Y%m%d')}_{active_load}"

df_final = df_merged.select(
    COL_CHANNEL_ID,
    col(COL_CHANNEL_URL).alias("channel_url"),
    col(COL_TITLE).alias("channel_title"),
    "primary_category",
    "primary_tier_path",
    spark_round("primary_confidence", 4).alias("primary_confidence"),
    "categories",
    "num_categories",
    "text_length",
    "confidence_bucket",
    "load_version",
    lit(model_version).alias("model_version"),
    current_timestamp().alias("run_timestamp"),
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Build Flat Output
# MAGIC
# MAGIC One row per channel-category pair. This makes SQL queries simple:
# MAGIC ```sql
# MAGIC SELECT * FROM channels_classification_flat
# MAGIC WHERE tier_path LIKE 'Sports%' AND confidence >= 0.5
# MAGIC ```

# COMMAND ----------

df_flat = (
    df_final.select(
        "channel_id", "channel_title", "channel_url",
        explode("categories").alias("cat"),
        "confidence_bucket", "load_version",
        "model_version", "run_timestamp",
    )
    .select(
        "channel_id",
        "channel_title",
        "channel_url",
        col("cat.iab_id").alias("iab_id"),
        col("cat.name").alias("category_name"),
        col("cat.tier_path").alias("tier_path"),
        col("cat.tier_level").alias("tier_level"),
        spark_round(col("cat.similarity"), 4).alias("confidence"),
        "confidence_bucket",
        "load_version",
        "model_version",
        "run_timestamp",
    )
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Validate

# COMMAND ----------

total_channels = df_final.count()
total_flat = df_flat.count()
categorized = df_final.filter(col("num_categories") > 0).count()

print(f"Channels:            {total_channels:,}")
print(f"Categorized:         {categorized:,} ({categorized/total_channels*100:.1f}%)")
print(f"Flat rows:           {total_flat:,} (avg {total_flat/total_channels:.1f} categories/channel)")
print(f"Model version:       {model_version}")

# COMMAND ----------

# Top categories by channel count
print("Top 20 categories (flat view):")
display(
    df_flat
    .groupBy("category_name", "tier_path", "tier_level")
    .agg(
        F.count("*").alias("channels"),
        spark_round(F.avg("confidence"), 3).alias("avg_confidence"),
    )
    .orderBy(F.desc("channels"))
    .limit(20)
)

# COMMAND ----------

# Tier distribution
print("Category assignments by tier level:")
display(
    df_flat
    .groupBy("tier_level")
    .agg(
        F.count("*").alias("assignments"),
        F.countDistinct("category_name").alias("distinct_categories"),
        spark_round(F.avg("confidence"), 3).alias("avg_confidence"),
    )
    .orderBy("tier_level")
)

# COMMAND ----------

# Sample channels with all their categories
for ch in ["MKBHD", "CoComelon", "MrBeast"]:
    sample = df_flat.filter(col("channel_title").contains(ch))
    if sample.count() > 0:
        print(f"\n=== {ch} ===")
        display(
            sample.select("category_name", "tier_path", "tier_level", "confidence")
            .orderBy(F.desc("confidence"))
        )

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Write Output

# COMMAND ----------

df_final.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(OUTPUT_TABLE)
print(f"Nested output: {OUTPUT_TABLE} ({total_channels:,} rows)")

df_flat.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(CLASSIFICATION_FLAT_TABLE)
print(f"Flat output:   {CLASSIFICATION_FLAT_TABLE} ({total_flat:,} rows)")
print(f"Model version: {model_version}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Example SQL Queries
# MAGIC
# MAGIC ```sql
# MAGIC -- All channels classified as Sports with confidence > 0.5
# MAGIC SELECT channel_id, channel_title, category_name, confidence
# MAGIC FROM channels_classification_flat
# MAGIC WHERE tier_path LIKE 'Sports%' AND confidence >= 0.5
# MAGIC ORDER BY confidence DESC
# MAGIC
# MAGIC -- Channels in BOTH Gaming AND Music
# MAGIC SELECT a.channel_id, a.channel_title,
# MAGIC        a.confidence AS gaming_conf, b.confidence AS music_conf
# MAGIC FROM channels_classification_flat a
# MAGIC JOIN channels_classification_flat b ON a.channel_id = b.channel_id
# MAGIC WHERE a.tier_path LIKE 'Video Gaming%'
# MAGIC   AND b.tier_path LIKE 'Entertainment > Music%'
# MAGIC
# MAGIC -- Category distribution
# MAGIC SELECT category_name, tier_level,
# MAGIC        COUNT(*) AS channels,
# MAGIC        ROUND(AVG(confidence), 3) AS avg_confidence
# MAGIC FROM channels_classification_flat
# MAGIC GROUP BY category_name, tier_level
# MAGIC ORDER BY channels DESC
# MAGIC
# MAGIC -- Channels with the most category labels
# MAGIC SELECT channel_id, channel_title, num_categories, primary_category
# MAGIC FROM channels_output
# MAGIC ORDER BY num_categories DESC
# MAGIC LIMIT 20
# MAGIC
# MAGIC -- Brand safety: find channels in sensitive categories
# MAGIC SELECT f.channel_id, f.channel_title, f.category_name, f.confidence
# MAGIC FROM channels_classification_flat f
# MAGIC JOIN iab_taxonomy t ON f.iab_id = t.unique_id
# MAGIC WHERE t.is_sensitive = true AND f.confidence >= 0.4
# MAGIC ```
