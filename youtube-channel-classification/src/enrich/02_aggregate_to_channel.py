# Databricks notebook source
# MAGIC %md
# MAGIC # Enrich Step 02: Aggregate Video Metadata to Channel Level
# MAGIC
# MAGIC Transform raw video-level data into enriched channel profiles with:
# MAGIC dominant category, aggregated tags, descriptions, engagement metrics, kids %, duration profile.
# MAGIC
# MAGIC **Input:** Raw video metadata table (from step 01)
# MAGIC **Output:** Enriched channel profiles table

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

import re
import json
from collections import Counter
from pyspark.sql import functions as F
from pyspark.sql.functions import col, when, lit, coalesce, lower
from pyspark.sql.types import StringType

# COMMAND ----------

df_videos = spark.table(RAW_VIDEOS_TABLE)
total_videos = df_videos.count()
total_channels = df_videos.select("channel_id").distinct().count()
print(f"Videos: {total_videos:,} across {total_channels:,} channels")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Parse Duration

# COMMAND ----------

@F.udf("int")
def parse_duration(d):
    """ISO 8601 duration (PT1H2M3S) → seconds."""
    if not d:
        return 0
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d)
    if not m:
        return 0
    return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)

df_videos = df_videos.withColumn("duration_seconds", parse_duration(col("duration")))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Aggregate with Spark SQL

# COMMAND ----------

df_videos = (
    df_videos
    .withColumn("view_count_l", col("view_count").cast("long"))
    .withColumn("like_count_l", col("like_count").cast("long"))
    .withColumn("comment_count_l", col("comment_count").cast("long"))
    .withColumn("is_kids_video", lower(coalesce(col("made_for_kids"), lit("false"))) == "true")
)

# COMMAND ----------

df_agg = (
    df_videos
    .groupBy("channel_id")
    .agg(
        F.count("*").alias("video_count_sampled"),
        F.sum("view_count_l").alias("total_views"),
        F.sum("like_count_l").alias("total_likes"),
        F.sum("comment_count_l").alias("total_comments"),
        F.avg("duration_seconds").alias("avg_duration_seconds"),
        F.percentile_approx("duration_seconds", 0.5).alias("median_duration_seconds"),
        F.avg(col("is_kids_video").cast("int")).alias("pct_made_for_kids"),
        F.collect_list("category_id").alias("all_category_ids"),
        F.collect_list("video_tags").alias("all_tags_raw"),
        F.collect_list("video_description").alias("all_descriptions"),
        F.collect_list("topic_categories").alias("all_topic_cats"),
        F.max(when(col("licensed_content") == "True", lit(True)).otherwise(lit(False))).alias("has_licensed_content"),
    )
)

print(f"Aggregated {df_agg.count():,} channel profiles")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2b. Extract Per-Video Text for Top 2 Videos
# MAGIC
# MAGIC For the v2 multi-embedding approach, we need separate text for the top 2 videos
# MAGIC per channel (ranked by view count). These become independent embeddings
# MAGIC alongside the channel profile embedding.

# COMMAND ----------

from pyspark.sql.window import Window

# Rank videos per channel by view count (best signal for "representative" videos)
video_window = Window.partitionBy("channel_id").orderBy(col("view_count_l").desc_nulls_last())

df_ranked = (
    df_videos
    .withColumn("video_rank", F.row_number().over(video_window))
    .filter(col("video_rank") <= 2)
)

# Build per-video text: title + description + tags
df_ranked = df_ranked.withColumn(
    "video_text",
    F.trim(F.concat_ws(" ",
        coalesce(col("video_title"), lit("")),
        coalesce(col("video_description"), lit("")),
        coalesce(col("video_tags"), lit("")),
    ))
)

# Pivot into video1_text and video2_text
df_video1 = (
    df_ranked.filter(col("video_rank") == 1)
    .select(col("channel_id"), col("video_text").alias("video1_text"))
)
df_video2 = (
    df_ranked.filter(col("video_rank") == 2)
    .select(col("channel_id"), col("video_text").alias("video2_text"))
)

df_per_video = (
    df_video1
    .join(df_video2, on="channel_id", how="left")
)

print(f"Per-video text extracted for {df_per_video.count():,} channels")
print(f"  With video1: {df_per_video.filter(col('video1_text') != '').count():,}")
print(f"  With video2: {df_per_video.filter(col('video2_text').isNotNull() & (col('video2_text') != '')).count():,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Compute Derived Fields

# COMMAND ----------

@F.udf(StringType())
def dominant_category(ids):
    if not ids:
        return None
    counts = Counter([i for i in ids if i])
    return counts.most_common(1)[0][0] if counts else None

@F.udf(StringType())
def category_distribution(ids):
    if not ids:
        return "{}"
    counts = Counter([i for i in ids if i])
    return json.dumps(dict(counts))

@F.udf(StringType())
def dominant_category_name(cat_id):
    if not cat_id:
        return None
    try:
        return VIDEO_CATEGORY_MAP.get(int(cat_id), "Unknown")
    except (ValueError, TypeError):
        return None

@F.udf(StringType())
def aggregate_tags(tags_list):
    if not tags_list:
        return ""
    all_tags = []
    for tags_str in tags_list:
        if tags_str:
            all_tags.extend([t.strip().lower() for t in tags_str.split(",") if t.strip()])
    counts = Counter(all_tags)
    top = [tag for tag, _ in counts.most_common(MAX_TAGS_PER_CHANNEL)]
    return " ".join(top)

@F.udf(StringType())
def aggregate_descriptions(descs):
    if not descs:
        return ""
    combined = " ".join([d for d in descs if d])
    return combined[:MAX_DESCRIPTION_CHARS]

@F.udf(StringType())
def aggregate_topic_cats(cats_list):
    if not cats_list:
        return ""
    topics = set()
    for cats_str in cats_list:
        if not cats_str:
            continue
        for url in cats_str.split(","):
            url = url.strip()
            if "wikipedia.org/wiki/" in url:
                topic = url.split("/wiki/")[-1].replace("_", " ").split("(")[0].strip()
                topics.add(topic)
    return " ".join(sorted(topics))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Build Enriched Profiles

# COMMAND ----------

df_enriched = (
    df_agg
    .withColumn("dominant_category_id", dominant_category(col("all_category_ids")))
    .withColumn("category_distribution", category_distribution(col("all_category_ids")))
    .withColumn("dominant_category_name", dominant_category_name(col("dominant_category_id")))
    .withColumn("aggregated_tags", aggregate_tags(col("all_tags_raw")))
    .withColumn("aggregated_descriptions", aggregate_descriptions(col("all_descriptions")))
    .withColumn("video_topic_categories", aggregate_topic_cats(col("all_topic_cats")))
    .withColumn("avg_engagement_ratio",
        when(col("total_views") > 0, F.round(col("total_likes") / col("total_views"), 6))
        .otherwise(lit(0.0)))
    .withColumn("pct_made_for_kids", F.round("pct_made_for_kids", 4))
    .withColumn("avg_duration_seconds", F.round("avg_duration_seconds", 1))
    .withColumn("median_duration_seconds", F.round(col("median_duration_seconds").cast("float"), 1))
)

# Join per-video text columns
df_enriched = df_enriched.join(df_per_video, on="channel_id", how="left")

df_enriched = df_enriched.select(
    "channel_id",
    "video_count_sampled",
    "dominant_category_id",
    "dominant_category_name",
    "category_distribution",
    "aggregated_tags",
    "aggregated_descriptions",
    "avg_duration_seconds",
    "median_duration_seconds",
    "total_views",
    "total_likes",
    "total_comments",
    "avg_engagement_ratio",
    "pct_made_for_kids",
    "video_topic_categories",
    "has_licensed_content",
    "video1_text",
    "video2_text",
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Validate & Write

# COMMAND ----------

print(f"Enriched profiles: {df_enriched.count():,}")

for c in ["dominant_category_name", "aggregated_tags", "aggregated_descriptions",
          "video_topic_categories"]:
    filled = df_enriched.filter(col(c).isNotNull() & (col(c) != "")).count()
    print(f"  {c:30s}: {filled:>8,} ({filled/df_enriched.count()*100:.1f}%)")

# COMMAND ----------

display(df_enriched.groupBy("dominant_category_name").count().orderBy(F.desc("count")))

# COMMAND ----------

display(
    df_enriched.filter(col("avg_duration_seconds") > 0).select(
        when(col("avg_duration_seconds") < 60, "< 1 min (Shorts)")
        .when(col("avg_duration_seconds") < 240, "1-4 min")
        .when(col("avg_duration_seconds") < 1200, "4-20 min")
        .when(col("avg_duration_seconds") < 3600, "20-60 min")
        .otherwise("> 60 min").alias("duration_bucket")
    ).groupBy("duration_bucket").count().orderBy("duration_bucket")
)

# COMMAND ----------

display(
    df_enriched.select(
        when(col("pct_made_for_kids") >= 0.8, "80-100% kids")
        .when(col("pct_made_for_kids") >= 0.5, "50-80% kids")
        .when(col("pct_made_for_kids") > 0, "1-50% kids")
        .otherwise("0% kids").alias("kids_level")
    ).groupBy("kids_level").count().orderBy("kids_level")
)

# COMMAND ----------

display(
    df_enriched.filter(col("aggregated_tags") != "").select(
        "channel_id", "dominant_category_name",
        F.substring("aggregated_tags", 1, 150).alias("top_tags"),
        "pct_made_for_kids", "avg_duration_seconds", "video_count_sampled",
    ).limit(15)
)

# COMMAND ----------

df_enriched.write.format("delta").mode("overwrite").saveAsTable(ENRICHED_TABLE)
print(f"Enriched profiles written to {ENRICHED_TABLE}")
