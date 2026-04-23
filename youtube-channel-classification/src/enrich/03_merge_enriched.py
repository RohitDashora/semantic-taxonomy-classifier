# Databricks notebook source
# MAGIC %md
# MAGIC # Enrich Step 03: Merge Enriched Data
# MAGIC
# MAGIC Join enriched video-level profiles with the existing channel data,
# MAGIC demonstrate the enriched text_input, and write a combined table
# MAGIC ready to feed into the classification pipeline.
# MAGIC
# MAGIC **Input:** Enriched profiles (step 02) + source channel data
# MAGIC **Output:** Combined enriched table → feeds into classify/01_data_prep.py

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.functions import col, concat_ws, coalesce, lit, length, when, lower

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Load & Join

# COMMAND ----------

# Load source channel data (same source as classification)
if DATA_SOURCE == "csv":
    df_channels = (
        spark.read
        .option("header", True)
        .option("inferSchema", True)
        .option("multiLine", True)
        .option("escape", '"')
        .csv(CSV_PATH)
    )
else:
    df_channels = spark.table(RAW_TABLE)

df_enriched = spark.table(ENRICHED_TABLE)

print(f"Source channels:     {df_channels.count():,}")
print(f"Enriched profiles:  {df_enriched.count():,}")

df_combined = df_channels.join(df_enriched, on="channel_id", how="left")

enriched_count = df_combined.filter(col("video_count_sampled").isNotNull()).count()
print(f"Channels with enrichment: {enriched_count:,} ({enriched_count/df_combined.count()*100:.1f}%)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Before vs After: Text Quality

# COMMAND ----------

# Build original text_input for comparison
def clean_null(c):
    return when(col(c) == "null", lit("")).otherwise(coalesce(col(c), lit("")))

df_combined = df_combined.withColumn(
    "original_text_length",
    length(concat_ws(" ",
        clean_null(COL_TITLE),
        clean_null(COL_DESCRIPTION),
        clean_null(COL_KEYWORDS),
    ))
)

# Build enriched text_input
df_combined = df_combined.withColumn(
    "enriched_text_input",
    concat_ws(" ",
        clean_null(COL_TITLE),
        clean_null(COL_DESCRIPTION),
        clean_null(COL_KEYWORDS),
        coalesce(col("aggregated_tags"), lit("")),
        coalesce(col("aggregated_descriptions"), lit("")),
        coalesce(col("video_topic_categories"), lit("")),
    )
)

df_combined = df_combined.withColumn("enriched_text_length", length(col("enriched_text_input")))

print("=== Original text length ===")
display(df_combined.select("original_text_length").summary("50%", "75%", "max"))

print("=== Enriched text length ===")
display(df_combined.select("enriched_text_length").summary("50%", "75%", "max"))

# COMMAND ----------

# Channels that had sparse original text but now have rich enriched text
sparse_original = df_combined.filter(
    (col("original_text_length") < 50) & (col("enriched_text_length") > 200)
)
print(f"Channels with sparse original but rich enriched text: {sparse_original.count():,}")
display(
    sparse_original.select(
        "channel_id", COL_TITLE,
        "original_text_length",
        "enriched_text_length",
        "dominant_category_name",
        F.substring("aggregated_tags", 1, 100).alias("sample_tags"),
    ).limit(10)
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Show Enrichment Value

# COMMAND ----------

print("=== Dominant Video Category (from video-level data) ===")
display(
    df_combined.filter(col("dominant_category_name").isNotNull())
    .groupBy("dominant_category_name")
    .count()
    .orderBy(F.desc("count"))
)

# COMMAND ----------

# Kids detection enhancement
original_kids = df_combined.filter(
    (lower(coalesce(col(COL_MADE_FOR_KIDS), lit("false"))) == "true")
    | (lower(coalesce(col(COL_SELF_DECL_KIDS), lit("false"))) == "true")
).count()

video_kids = df_combined.filter(
    coalesce(col("pct_made_for_kids"), lit(0.0)) >= 0.5
).count()

print(f"Kids channels (original API flags):  {original_kids:,}")
print(f"Kids channels (video-level >=50%):   {video_kids:,}")
print(f"Additional kids detected:            {max(0, video_kids - original_kids):,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Write Combined Enriched Table

# COMMAND ----------

# Enhanced kids signal from video-level data
df_output = df_combined.withColumn(
    "is_kids_enhanced",
    (lower(coalesce(col(COL_MADE_FOR_KIDS), lit("false"))) == "true")
    | (lower(coalesce(col(COL_SELF_DECL_KIDS), lit("false"))) == "true")
    | (coalesce(col("pct_made_for_kids"), lit(0.0)) >= 0.5)
)

df_output.write.format("delta").mode("overwrite").saveAsTable(COMBINED_TABLE)
print(f"Combined enriched table written to {COMBINED_TABLE}")
print(f"Total channels: {df_output.count():,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Next: Run Classification
# MAGIC
# MAGIC The `enrich-and-classify` DAB job automatically feeds this table
# MAGIC into the classification pipeline via `data_source_override`.
# MAGIC
# MAGIC For manual use, set the widget in `classify/01_data_prep.py`:
# MAGIC ```
# MAGIC data_source_override = "<catalog>.<schema>.channels_enriched_combined"
# MAGIC ```
