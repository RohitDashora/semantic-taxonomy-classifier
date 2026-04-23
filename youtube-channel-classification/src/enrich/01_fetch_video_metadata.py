# Databricks notebook source
# MAGIC %md
# MAGIC # Enrich Step 01: Fetch Video-Level Metadata
# MAGIC
# MAGIC For each channel, discover top video IDs via PlaylistItems API, then pull
# MAGIC video metadata via Videos API using **cross-channel batching** to minimize cost.
# MAGIC
# MAGIC **Note on parallelism:** API calls run sequentially on the driver node. This is intentional —
# MAGIC a single YouTube API key has rate limits (~10 req/s) and daily quota limits.
# MAGIC Distributing calls across Spark workers with one API key would cause 403 rate-limit errors.
# MAGIC The bottleneck is YouTube quota, not compute. For higher throughput, use multiple API keys
# MAGIC and partition channels across them.
# MAGIC
# MAGIC **Cost per channel:** `1 + (videos_per_channel / 50)` API units
# MAGIC
# MAGIC | videos_per_channel | units/channel | 10K channels | 100K channels | 1.5M channels |
# MAGIC |--------------------|---------------|-------------|--------------|---------------|
# MAGIC |                  1 |          1.02 |       10.2K |         102K |         1.53M |
# MAGIC |                  2 |          1.04 |       10.4K |         104K |         1.56M |
# MAGIC |                  5 |          1.10 |         11K |         110K |         1.65M |
# MAGIC |                 10 |          1.20 |         12K |         120K |         1.80M |
# MAGIC |                 25 |          1.50 |         15K |         150K |         2.25M |
# MAGIC |                 50 |          2.00 |         20K |         200K |         3.00M |
# MAGIC
# MAGIC **Input:** Source table with channel_id (+ optionally relatedplaylist_uploads)
# MAGIC **Output:** Raw video metadata table (one row per video)

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

# MAGIC %pip install google-api-python-client

# COMMAND ----------

dbutils.library.restartPython()

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

import json
import time
import re
from datetime import datetime
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from pyspark.sql import functions as F

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Initialize

# COMMAND ----------

API_KEY = dbutils.secrets.get(scope=SECRET_SCOPE, key=SECRET_KEY)
youtube = build("youtube", "v3", developerKey=API_KEY)

class QuotaTracker:
    def __init__(self, limit, margin=0.9):
        self.limit = int(limit * margin)
        self.used = 0
    def use(self, n=1): self.used += n
    def ok(self, cost=1): return self.used + cost <= self.limit
    def summary(self): return f"Quota: {self.used:,}/{self.limit:,} ({self.used/self.limit*100:.1f}%)"

quota = QuotaTracker(DAILY_QUOTA_LIMIT, QUOTA_SAFETY_MARGIN)
print(f"Quota budget: {quota.limit:,} units")
print(f"Videos per channel: {VIDEOS_PER_CHANNEL}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Build Processing Queue

# COMMAND ----------

if DEV_CHANNEL_IDS:
    channels = [
        {COL_CHANNEL_ID: cid, COL_UPLOADS_PLAYLIST: "UU" + cid[2:]}
        for cid in DEV_CHANNEL_IDS
    ]
    print(f"[DEV] Processing {len(channels)} channels: {DEV_CHANNEL_IDS}")
else:
    # Read from the same source as classification
    if DATA_SOURCE == "csv":
        df_source = (
            spark.read
            .option("header", True)
            .option("inferSchema", True)
            .option("multiLine", True)
            .option("escape", '"')
            .csv(CSV_PATH)
        )
    else:
        df_source = spark.table(RAW_TABLE)

    # Check for checkpoint
    try:
        df_cp = spark.table(ENRICHMENT_CHECKPOINT_TABLE)
        done_ids = set(row.channel_id for row in df_cp.select("channel_id").collect())
        print(f"Checkpoint: {len(done_ids):,} channels already enriched")
    except Exception:
        done_ids = set()
        print("No checkpoint — starting fresh")

    # Filter + priority sort
    df_queue = df_source.filter(~F.col(COL_CHANNEL_ID).isin(done_ids))
    if PRIORITY_COL and PRIORITY_COL in df_queue.columns and PRIORITY_SAMPLE_SIZE:
        df_queue = df_queue.orderBy(F.desc(PRIORITY_COL)).limit(PRIORITY_SAMPLE_SIZE)

    # Collect — use uploads playlist if available, otherwise construct from channel_id
    if COL_UPLOADS_PLAYLIST in df_queue.columns:
        channels = df_queue.select(COL_CHANNEL_ID, COL_UPLOADS_PLAYLIST).toPandas().to_dict("records")
    else:
        channels = df_queue.select(COL_CHANNEL_ID).toPandas().to_dict("records")
        for ch in channels:
            cid = ch[COL_CHANNEL_ID]
            ch[COL_UPLOADS_PLAYLIST] = "UU" + cid[2:] if cid.startswith("UC") else None

    print(f"Channels to process: {len(channels):,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. API Helper Functions

# COMMAND ----------

def get_video_ids(playlist_id, max_results):
    """Get video IDs from uploads playlist. Cost: 1 unit."""
    try:
        resp = youtube.playlistItems().list(
            part="contentDetails",
            playlistId=playlist_id,
            maxResults=min(max_results, 50),
        ).execute()
        quota.use(1)
        return [
            item["contentDetails"]["videoId"]
            for item in resp.get("items", [])
            if item.get("contentDetails", {}).get("videoId")
        ][:max_results]
    except HttpError as e:
        if e.resp.status != 404:
            print(f"PlaylistItems error {playlist_id}: {e}")
        return []


def get_videos_batch(video_ids):
    """Get metadata for a batch of video IDs. Cost: 1 unit per 50 videos."""
    if not video_ids:
        return []
    all_videos = []
    for i in range(0, len(video_ids), VIDEO_BATCH_SIZE):
        batch = video_ids[i:i + VIDEO_BATCH_SIZE]
        for attempt in range(API_RETRY_ATTEMPTS):
            try:
                resp = youtube.videos().list(
                    part=VIDEO_PARTS,
                    id=",".join(batch),
                ).execute()
                quota.use(1)
                all_videos.extend(resp.get("items", []))
                break
            except HttpError as e:
                if e.resp.status == 403:
                    print(f"Quota exceeded! {quota.summary()}")
                    return all_videos
                if attempt < API_RETRY_ATTEMPTS - 1:
                    time.sleep(API_RETRY_DELAY * (attempt + 1))
            except Exception as e:
                print(f"Unexpected error: {e}")
                break
    return all_videos


def flatten_video(video, channel_id):
    """Flatten a video API response into a row dict."""
    snip = video.get("snippet", {})
    cd = video.get("contentDetails", {})
    stats = video.get("statistics", {})
    topics = video.get("topicDetails", {})
    status = video.get("status", {})

    return {
        "video_id": video.get("id"),
        "channel_id": channel_id,
        "video_title": snip.get("title"),
        "video_description": (snip.get("description") or "")[:2000],
        "video_tags": ",".join(snip.get("tags", [])) if snip.get("tags") else None,
        "category_id": snip.get("categoryId"),
        "published_at": snip.get("publishedAt"),
        "duration": cd.get("duration"),
        "caption": cd.get("caption"),
        "licensed_content": str(cd.get("licensedContent", False)),
        "view_count": stats.get("viewCount", "0"),
        "like_count": stats.get("likeCount", "0"),
        "comment_count": stats.get("commentCount", "0"),
        "topic_categories": ",".join(topics.get("topicCategories", [])),
        "made_for_kids": str(status.get("madeForKids", "")).lower() if status.get("madeForKids") is not None else None,
        "fetch_timestamp": datetime.now().isoformat(),
    }

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Fetch with Cross-Channel Batching
# MAGIC
# MAGIC Collects video IDs from multiple channels and batches them into a single
# MAGIC Videos.list API call (up to 50 IDs per call).

# COMMAND ----------

results = []
errors = []
video_id_buffer = []  # (video_id, channel_id) tuples
checkpoint_interval = 500
start_time = datetime.now()

print(f"Starting enrichment at {start_time.isoformat()}")
print(f"Videos per channel: {VIDEOS_PER_CHANNEL}")
print(f"Cross-channel batch size: {VIDEO_BATCH_SIZE} video IDs per Videos.list call")
print(f"  → 1 Videos.list call per ~{VIDEO_BATCH_SIZE // VIDEOS_PER_CHANNEL} channels")
print("-" * 60)


def flush_video_buffer():
    """Call Videos.list for all buffered video IDs and add to results."""
    global video_id_buffer
    if not video_id_buffer:
        return

    ids_only = [vid for vid, _ in video_id_buffer]
    id_to_channel = {vid: cid for vid, cid in video_id_buffer}

    videos = get_videos_batch(ids_only)
    for v in videos:
        vid = v.get("id")
        cid = id_to_channel.get(vid, "unknown")
        results.append(flatten_video(v, cid))

    video_id_buffer = []


# Main loop
for i, ch in enumerate(channels):
    if not quota.ok(1):
        print(f"\nQuota limit. {quota.summary()}")
        break

    cid = ch[COL_CHANNEL_ID]
    playlist = ch.get(COL_UPLOADS_PLAYLIST)

    if not playlist or playlist == "null":
        playlist = "UU" + cid[2:] if cid.startswith("UC") else None
    if not playlist:
        continue

    try:
        vids = get_video_ids(playlist, VIDEOS_PER_CHANNEL)

        for vid in vids:
            video_id_buffer.append((vid, cid))

        if len(video_id_buffer) >= VIDEO_BATCH_SIZE:
            flush_video_buffer()

    except Exception as e:
        errors.append({"channel_id": cid, "error": str(e)})

    if (i + 1) % 100 == 0:
        elapsed = (datetime.now() - start_time).total_seconds()
        rate = (i + 1) / elapsed * 3600 if elapsed > 0 else 0
        print(
            f"  [{i+1:>6,}/{len(channels):,}] {quota.summary()} | "
            f"{rate:.0f} ch/hr | {len(results)} videos | buf={len(video_id_buffer)}"
        )

    if (i + 1) % checkpoint_interval == 0 and results:
        flush_video_buffer()
        df_batch = spark.createDataFrame(results)
        df_batch.write.format("delta").mode("append").saveAsTable(RAW_VIDEOS_TABLE)
        processed_ids = list(set(r["channel_id"] for r in results))
        df_cp = spark.createDataFrame([{"channel_id": c} for c in processed_ids])
        df_cp.write.format("delta").mode("append").saveAsTable(ENRICHMENT_CHECKPOINT_TABLE)
        print(f"  >> Checkpoint: {len(results)} videos from {len(processed_ids)} channels")
        results = []

# COMMAND ----------

# Flush remaining
flush_video_buffer()

if results:
    df_final = spark.createDataFrame(results)
    df_final.write.format("delta").mode("append").saveAsTable(RAW_VIDEOS_TABLE)
    processed_ids = list(set(r["channel_id"] for r in results))
    df_cp = spark.createDataFrame([{"channel_id": c} for c in processed_ids])
    df_cp.write.format("delta").mode("append").saveAsTable(ENRICHMENT_CHECKPOINT_TABLE)

elapsed = (datetime.now() - start_time).total_seconds()
print(f"\nComplete in {elapsed/60:.1f} min | Errors: {len(errors)} | {quota.summary()}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Validate

# COMMAND ----------

df_videos = spark.table(RAW_VIDEOS_TABLE)
total_vids = df_videos.count()
total_chs = df_videos.select("channel_id").distinct().count()

print(f"Total video records:  {total_vids:,}")
print(f"Distinct channels:   {total_chs:,}")
print(f"Avg videos/channel:  {total_vids / total_chs:.1f}" if total_chs > 0 else "N/A")
print(f"API units used:      {quota.used:,}")
print(f"Units per channel:   {quota.used / total_chs:.2f}" if total_chs > 0 else "N/A")

# COMMAND ----------

display(
    df_videos.select(
        "channel_id", "video_title", "category_id", "video_tags", "made_for_kids",
    ).limit(10)
)

# COMMAND ----------

if errors:
    print(f"Errors: {len(errors)}")
    display(spark.createDataFrame(errors).limit(20))
else:
    print("No errors.")
