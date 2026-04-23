# Databricks notebook source
# MAGIC %md
# MAGIC # Step 01: Data Preparation
# MAGIC
# MAGIC Load channel metadata, clean text fields, parse topic categories,
# MAGIC and produce a prepped table ready for embeddings.
# MAGIC
# MAGIC **Input:** CSV file or Delta table with channel metadata (or enriched combined table)
# MAGIC **Output:** Prepped channels table with `text_input` column

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.functions import (
    col, concat_ws, coalesce, lit, lower, regexp_replace, trim, length,
    when, split, explode, desc, count,
)
from pyspark.sql.types import ArrayType, StringType

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Load Data

# COMMAND ----------

# If data_source_override is set (e.g., enriched combined table from enrich-and-classify job), use it
if DATA_SOURCE_OVERRIDE:
    df_raw = spark.table(DATA_SOURCE_OVERRIDE)
    print(f"Loaded from override table: {DATA_SOURCE_OVERRIDE}")
elif DATA_SOURCE == "csv":
    df_raw = (
        spark.read
        .option("header", True)
        .option("inferSchema", True)
        .option("multiLine", True)
        .option("escape", '"')
        .csv(CSV_PATH)
    )
    print(f"Loaded from CSV: {CSV_PATH}")
else:
    df_raw = spark.table(RAW_TABLE)
    print(f"Loaded from table: {RAW_TABLE}")

# Apply dev mode filtering
if DEV_CHANNEL_IDS:
    dev_match = df_raw.filter(col(COL_CHANNEL_ID).isin(DEV_CHANNEL_IDS)).count()
    if dev_match > 0:
        df_raw = df_raw.filter(col(COL_CHANNEL_ID).isin(DEV_CHANNEL_IDS))
        print(f"[DEV] Filtered to {dev_match} dev channel IDs")
    elif SAMPLE_SIZE:
        df_raw = df_raw.limit(SAMPLE_SIZE)
        print(f"[DEV] Dev channels not in data — sampled {SAMPLE_SIZE} rows instead")
elif SAMPLE_SIZE:
    df_raw = df_raw.limit(SAMPLE_SIZE)
    print(f"[DEV] Sampled {SAMPLE_SIZE} rows")

total = df_raw.count()
print(f"Total channels to process: {total:,}")
print(f"Columns: {df_raw.columns}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Inspect Field Population

# COMMAND ----------

key_fields = [
    COL_TITLE, COL_DESCRIPTION, COL_KEYWORDS, COL_TOPIC_CATEGORIES,
    COL_MADE_FOR_KIDS, COL_SELF_DECL_KIDS, COL_COUNTRY, COL_LANGUAGE,
    COL_SUBSCRIBERS, COL_VIEWS, COL_VIDEO_COUNT,
]

population_stats = []
for field in key_fields:
    if field in df_raw.columns:
        field_type = df_raw.schema[field].dataType.simpleString()
        if field_type == "string":
            non_null = df_raw.filter(
                col(field).isNotNull() & (col(field) != "") & (col(field) != "null")
            ).count()
        else:
            non_null = df_raw.filter(col(field).isNotNull()).count()
        population_stats.append((field, non_null, round(non_null / total * 100, 1)))
    else:
        population_stats.append((field, 0, 0.0))

display(spark.createDataFrame(population_stats, ["field", "non_null_count", "pct_populated"]))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Filter Out Invalid Channels

# COMMAND ----------

if COL_MISSING in df_raw.columns:
    missing = df_raw.filter(col(COL_MISSING) == "true").count()
    df_raw = df_raw.filter((col(COL_MISSING) != "true") | col(COL_MISSING).isNull())
    print(f"Removed {missing:,} channels missing from YouTube")
    print(f"Remaining: {df_raw.count():,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Parse topicdetails_categories
# MAGIC Comma-separated Wikipedia URLs → plain topic names.

# COMMAND ----------

@F.udf(ArrayType(StringType()))
def parse_topic_categories(categories_str):
    """Extract topic names from comma-separated Wikipedia URLs."""
    if not categories_str or categories_str == "null":
        return []
    topics = []
    for url in categories_str.split(","):
        url = url.strip()
        if "wikipedia.org/wiki/" in url:
            topic = url.split("/wiki/")[-1].replace("_", " ")
            topic = topic.split("(")[0].strip()
            topics.append(topic)
    return topics

df_raw = df_raw.withColumn("parsed_topics", parse_topic_categories(col(COL_TOPIC_CATEGORIES)))

print("=== Top Topic Categories ===")
display(
    df_raw.select(explode("parsed_topics").alias("topic"))
    .groupBy("topic")
    .agg(count("*").alias("count"))
    .orderBy(desc("count"))
    .limit(25)
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Build text_input

# COMMAND ----------

def clean_null(c):
    return when(col(c) == "null", lit("")).otherwise(coalesce(col(c), lit("")))

def clean_text_col(df, col_name):
    """Apply standard text cleaning to a column."""
    return (
        df
        .withColumn(col_name, lower(col(col_name)))
        .withColumn(col_name, regexp_replace(col_name, r"https?://\S+", ""))
        .withColumn(col_name, regexp_replace(col_name, r"[^\w\s]", " "))
        .withColumn(col_name, regexp_replace(col_name, r"\s+", " "))
        .withColumn(col_name, trim(col(col_name)))
    )

# ── channel_text: channel profile only (title + desc + keywords + topics) ──
channel_text_parts = [
    clean_null(COL_TITLE),
    clean_null(COL_DESCRIPTION),
    clean_null(COL_KEYWORDS),
    concat_ws(" ", col("parsed_topics")),
]

df_prepped = df_raw.withColumn(
    "channel_text",
    trim(concat_ws(" ", *channel_text_parts))
)

# ── video1_text, video2_text: from enrichment if available, else NULL ──
if "video1_text" in df_raw.columns:
    # Enriched data already has per-video text from 02_aggregate_to_channel.py
    print("[v2] Using per-video text from enrichment pipeline")
else:
    df_prepped = df_prepped.withColumn("video1_text", lit(None).cast("string"))
    df_prepped = df_prepped.withColumn("video2_text", lit(None).cast("string"))
    print("[v2] No enrichment — video1_text/video2_text set to NULL")

# ── text_input: concatenation of all sources (legacy compat for Explorer app) ──
text_parts = [col("channel_text")]

# Include enrichment aggregates in text_input if available
if "aggregated_tags" in df_raw.columns:
    text_parts.append(coalesce(col("aggregated_tags"), lit("")))
if "aggregated_descriptions" in df_raw.columns:
    text_parts.append(coalesce(col("aggregated_descriptions"), lit("")))
if "video_topic_categories" in df_raw.columns:
    text_parts.append(coalesce(col("video_topic_categories"), lit("")))

df_prepped = df_prepped.withColumn(
    "text_input",
    trim(concat_ws(" ", *text_parts))
)

# Apply text cleaning to all text columns
df_prepped = clean_text_col(df_prepped, "channel_text")
df_prepped = clean_text_col(df_prepped, "text_input")

# Clean video text columns only if non-null
for vcol in ["video1_text", "video2_text"]:
    df_prepped = (
        df_prepped
        .withColumn(vcol,
            when(col(vcol).isNotNull() & (col(vcol) != ""),
                trim(regexp_replace(
                    regexp_replace(
                        regexp_replace(lower(col(vcol)), r"https?://\S+", ""),
                        r"[^\w\s]", " "
                    ),
                    r"\s+", " "
                ))
            )
        )
    )

df_prepped = df_prepped.withColumn("text_length", length(col("text_input")))

# COMMAND ----------

display(df_prepped.select("text_length").summary("count", "min", "25%", "50%", "75%", "max"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Filter & Write Output

# COMMAND ----------

df_output = df_prepped.filter(col("text_length") >= MIN_TEXT_LENGTH)

insufficient = df_prepped.filter(col("text_length") < MIN_TEXT_LENGTH).count()
print(f"Channels with insufficient text (< {MIN_TEXT_LENGTH} chars): {insufficient:,}")
print(f"Channels proceeding to embedding: {df_output.count():,}")

# COMMAND ----------

df_output.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(PREPPED_TABLE)
print(f"Wrote prepped data to {PREPPED_TABLE}")

# COMMAND ----------

display(
    df_output.select(
        COL_CHANNEL_ID, COL_TITLE, "text_length",
        F.substring("channel_text", 1, 150).alias("channel_text_preview"),
        when(col("video1_text").isNotNull(), F.substring("video1_text", 1, 100)).alias("video1_preview"),
        when(col("video2_text").isNotNull(), F.substring("video2_text", 1, 100)).alias("video2_preview"),
    ).limit(10)
)
