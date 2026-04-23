# Databricks notebook source
# MAGIC %md
# MAGIC # Pipeline Configuration
# MAGIC
# MAGIC Unified configuration for the YouTube Channel Classification pipeline.
# MAGIC Covers classification (IAB taxonomy), optional video-level enrichment,
# MAGIC and independent Kids classifier.
# MAGIC
# MAGIC **Parameterized via widgets** — DAB jobs pass values through `base_parameters`;
# MAGIC interactive use falls back to widget defaults.

# COMMAND ----------

# ============================================
# WIDGET PARAMETERS (overridable by DAB jobs)
# ============================================
dbutils.widgets.text("catalog", "main", "Unity Catalog")
dbutils.widgets.text("schema", "youtube_channels", "Schema")
dbutils.widgets.text("run_mode", "dev", "Run mode: dev or prod")
dbutils.widgets.text("videos_per_channel", "2", "Videos per channel for enrichment (1-50)")
dbutils.widgets.text("data_source_override", "", "Override source table (used by enrich-and-classify job)")
dbutils.widgets.text("csv_filename", "channels_data_sample.csv", "CSV filename in /Volumes/<catalog>/<schema>/raw/ (when DATA_SOURCE='csv')")

CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
RUN_MODE = dbutils.widgets.get("run_mode")
VIDEOS_PER_CHANNEL = max(1, min(50, int(dbutils.widgets.get("videos_per_channel"))))
DATA_SOURCE_OVERRIDE = dbutils.widgets.get("data_source_override").strip()
CSV_FILENAME = dbutils.widgets.get("csv_filename").strip()

# COMMAND ----------

# ============================================
# RUN MODE: "dev" for testing, "prod" for full scale
# ============================================
if RUN_MODE == "dev":
    SAMPLE_SIZE = 10             # Only process N channels from CSV/table
    DAILY_QUOTA_LIMIT = 200      # Stay within developer API quota
    PRIORITY_SAMPLE_SIZE = None  # Process all (only 3 channels in dev)
    DEV_CHANNEL_IDS = [          # Known channels for spot-checking
        "UCbCmjCuTUZos6Inko4u57UQ",   # CoComelon (Kids)
        "UCBJycsmduvYEL83R_U4JriQ",   # MKBHD (Tech)
        "UCX6OQ3DkcsbYNE6H8uQQuVA",   # MrBeast (Entertainment)
    ]
else:  # prod
    SAMPLE_SIZE = None           # Process all
    DAILY_QUOTA_LIMIT = 10000    # Increase after Google quota approval
    PRIORITY_SAMPLE_SIZE = 100000
    DEV_CHANNEL_IDS = None

# COMMAND ----------

# ============================================
# DATA SOURCE
# ============================================
# Option A: Read from CSV (prototyping / first run).
# CSV_FILENAME is set via widget at top of file — default points at the
# 20-row schema sample shipped in data/; override per run for your own file.
CSV_PATH = f"/Volumes/{CATALOG}/{SCHEMA}/raw/{CSV_FILENAME}"

# Option B: Read from Delta table (production)
RAW_TABLE = f"{CATALOG}.{SCHEMA}.channels_data"

# Set to "csv" or "delta"
DATA_SOURCE = "delta"

# ============================================
# OUTPUT TABLES (all derived from catalog.schema)
# ============================================
# Classification pipeline
PREPPED_TABLE = f"{CATALOG}.{SCHEMA}.channels_prepped"
EMBEDDINGS_TABLE = f"{CATALOG}.{SCHEMA}.channels_embeddings"
CLASSIFIED_TABLE = f"{CATALOG}.{SCHEMA}.channels_classified"
CLASSIFICATION_FLAT_TABLE = f"{CATALOG}.{SCHEMA}.channels_classification_flat"
OUTPUT_TABLE = f"{CATALOG}.{SCHEMA}.channels_output"

# IAB Taxonomy
IAB_TAXONOMY_TABLE = f"{CATALOG}.{SCHEMA}.iab_taxonomy"
IAB_EMBEDDINGS_TABLE = f"{CATALOG}.{SCHEMA}.iab_taxonomy_embeddings"

# Kids classifier (independent)
KIDS_SCORES_TABLE = f"{CATALOG}.{SCHEMA}.kids_scores"

# Enrichment pipeline
RAW_VIDEOS_TABLE = f"{CATALOG}.{SCHEMA}.raw_video_metadata"
ENRICHED_TABLE = f"{CATALOG}.{SCHEMA}.channels_enriched"
ENRICHMENT_CHECKPOINT_TABLE = f"{CATALOG}.{SCHEMA}.enrichment_checkpoint"
COMBINED_TABLE = f"{CATALOG}.{SCHEMA}.channels_enriched_combined"

# v2 pipeline tables (Load 0 + Load 1)
CHANNEL_EMBEDDINGS_V2_TABLE = f"{CATALOG}.{SCHEMA}.channel_embeddings_v2"
CHANNEL_CANDIDATES_TABLE = f"{CATALOG}.{SCHEMA}.channel_candidates"
CHANNEL_FINAL_LABELS_TABLE = f"{CATALOG}.{SCHEMA}.channel_final_labels"
KNN_REFERENCE_POOL_TABLE = f"{CATALOG}.{SCHEMA}.knn_reference_pool"

# COMMAND ----------

# ============================================
# COLUMN NAMES (match these to your channels_data source schema)
# ============================================
COL_CHANNEL_ID = "channel_id"
COL_CHANNEL_URL = "channel_url"
COL_TITLE = "title"
COL_DESCRIPTION = "description"
COL_KEYWORDS = "brandsettings_channel_keywords"        # space-separated
COL_BRAND_DESC = "brandsettings_channel_desc"
COL_BRAND_TITLE = "brandsettings_channel_title"
COL_TOPIC_CATEGORIES = "topicdetails_categories"       # comma-separated Wikipedia URLs
COL_MADE_FOR_KIDS = "status_madeforkids"               # string: "true"/"false"/null
COL_SELF_DECL_KIDS = "status_selfdeclmadeforkids"      # string: "true"/"false"/null
COL_COUNTRY = "country"
COL_LANGUAGE = "default_lang"
COL_SUBSCRIBERS = "subscribercount"
COL_VIEWS = "viewcount"
COL_VIDEO_COUNT = "videocount"
COL_UPLOADS_PLAYLIST = "relatedplaylist_uploads"
COL_MISSING = "missing_in_youtube"

# COMMAND ----------

# ============================================
# IAB TAXONOMY
# ============================================
IAB_TAXONOMY_URL = "https://raw.githubusercontent.com/InteractiveAdvertisingBureau/Taxonomies/main/Content%20Taxonomies/Content%20Taxonomy%203.0.tsv"
IAB_TAXONOMY_RAW_TABLE = f"{CATALOG}.{SCHEMA}.iab_taxonomy_raw"
IAB_TAXONOMY_PATH = f"/Volumes/{CATALOG}/{SCHEMA}/raw/iab_content_taxonomy_3.0.tsv"  # fallback: local TSV
IAB_DESCRIPTION_MODEL = "databricks-claude-sonnet-4-6"

# ============================================
# CLASSIFICATION (cosine similarity) — legacy, used by v1 pipeline
# ============================================
SIMILARITY_THRESHOLD = 0.3         # Minimum cosine similarity to assign a category
MAX_CATEGORIES_PER_CHANNEL = 10    # Cap on multi-label assignments
TIER1_THRESHOLD = 0.3              # Threshold for broad Tier 1 categories
TIER2_THRESHOLD = 0.35             # Slightly higher for specific subcategories

# ============================================
# LOAD 0 v2: TAXONOMY-BASED CLASSIFICATION
# ============================================
# Multi-embedding weighted scoring
L0_WEIGHT_CHANNEL = 0.4            # Weight for channel profile embedding
L0_WEIGHT_VIDEO1 = 0.3             # Weight for video 1 embedding
L0_WEIGHT_VIDEO2 = 0.3             # Weight for video 2 embedding

# Candidate selection and filtering
L0_TOP_CANDIDATES = 10             # Top N candidates before filtering
L0_SCORE_THRESHOLD = 0.62          # Minimum score to retain a category
L0_SCORE_GAP = 0.12               # Max gap from best score: score >= best - this
L0_STRONG_WINNER_GAP = 0.08       # If score1 - score2 > this, publish 1 label
L0_MAX_LABELS = 3                  # Max labels to publish (1 if strong winner)

# ============================================
# LOAD 1: KNN SIGNAL
# ============================================
L1_WEIGHT_L0 = 0.75               # Weight for L0 score in blended score
L1_WEIGHT_KNN = 0.25              # Weight for KNN support
KNN_POOL_MIN_SCORE = 0.75         # Min top score to enter KNN reference pool
KNN_POOL_MIN_GAP = 0.10           # Min score gap to enter KNN reference pool
KNN_K = 20                        # Number of nearest neighbors to retrieve

# ============================================
# EMBEDDING MODEL
# ============================================
# Option A: Foundation Model API (no GPU needed)
EMBEDDING_MODEL_FMAPI = "databricks-gte-large-en"
EMBEDDING_DIMENSION = 1024

# Option B: Self-hosted sentence-transformers (GPU cluster)
EMBEDDING_MODEL_HF = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIMENSION_HF = 384

USE_FOUNDATION_MODEL_API = True

# ============================================
# KIDS CLASSIFIER (independent process)
# ============================================
KIDS_CONFIDENCE_THRESHOLD = 0.5
KIDS_SEED_TABLE = f"{CATALOG}.{SCHEMA}.kids_seed_channels"
KIDS_SEED_ID_COL = "channel_id"
USE_KIDS_SEED = False  # Set to True when seed table is available
TEST_SIZE = 0.2
RANDOM_STATE = 42

# ============================================
# MLFLOW
# ============================================
MLFLOW_EXPERIMENT_NAME = f"/Shared/youtube-channel-classification"

# ============================================
# TEXT PREPROCESSING
# ============================================
MIN_TEXT_LENGTH = 10
MAX_TEXT_LENGTH = 2000

# COMMAND ----------

# ============================================
# YOUTUBE API (for enrichment)
# ============================================
SECRET_SCOPE = "youtube"
SECRET_KEY = "api_key"
VIDEO_PARTS = "snippet,contentDetails,statistics,topicDetails,status"
QUOTA_SAFETY_MARGIN = 0.9

# ============================================
# ENRICHMENT PARAMETERS
# ============================================
PRIORITY_COL = "subscribercount"
VIDEO_BATCH_SIZE = 50             # Max video IDs per Videos.list call (API limit)
MAX_TAGS_PER_CHANNEL = 50
MAX_DESCRIPTION_CHARS = 5000
API_RETRY_ATTEMPTS = 3
API_RETRY_DELAY = 2

# ============================================
# API COST REFERENCE
# ============================================
# Per channel: 1 PlaylistItems call + (videos_per_channel / 50) Videos.list calls
#
# | videos_per_channel | units/channel | 10K channels | 100K channels | 1.5M channels |
# |--------------------|---------------|-------------|--------------|---------------|
# |                  1 |          1.02 |      10.2K  |        102K  |        1.53M  |
# |                  2 |          1.04 |      10.4K  |        104K  |        1.56M  |
# |                  5 |          1.10 |        11K  |        110K  |        1.65M  |
# |                 10 |          1.20 |        12K  |        120K  |        1.80M  |
# |                 25 |          1.50 |        15K  |        150K  |        2.25M  |
# |                 50 |          2.00 |        20K  |        200K  |        3.00M  |
#
# Default daily quota: 10,000 units. Request increase via Google Cloud Console.

# COMMAND ----------

# ============================================
# YOUTUBE VIDEO CATEGORY MAP
# ============================================
VIDEO_CATEGORY_MAP = {
    1: "Film & Animation",
    2: "Autos & Vehicles",
    10: "Music",
    15: "Pets & Animals",
    17: "Sports",
    19: "Travel & Events",
    20: "Gaming",
    22: "People & Blogs",
    23: "Comedy",
    24: "Entertainment",
    25: "News & Politics",
    26: "Howto & Style",
    27: "Education",
    28: "Science & Technology",
    29: "Nonprofits & Activism",
}

# COMMAND ----------

def print_config():
    print("=" * 60)
    print(f"YouTube Channel Classification [{RUN_MODE.upper()} MODE]")
    print("=" * 60)
    print(f"  Catalog.Schema:       {CATALOG}.{SCHEMA}")
    print(f"  Run mode:             {RUN_MODE}")
    print(f"  Sample size:          {SAMPLE_SIZE or 'ALL'}")
    print(f"  Dev channels:         {DEV_CHANNEL_IDS if DEV_CHANNEL_IDS else 'N/A'}")
    print(f"  Data source:          {DATA_SOURCE_OVERRIDE or (DATA_SOURCE + ' (' + (CSV_PATH if DATA_SOURCE == 'csv' else RAW_TABLE) + ')')}")
    print(f"  Embedding model:      {'FMAPI: ' + EMBEDDING_MODEL_FMAPI if USE_FOUNDATION_MODEL_API else 'HF: ' + EMBEDDING_MODEL_HF}")
    print(f"  IAB taxonomy table:   {IAB_TAXONOMY_TABLE}")
    print(f"  Similarity threshold: {SIMILARITY_THRESHOLD}")
    print(f"  Max categories/ch:    {MAX_CATEGORIES_PER_CHANNEL}")
    print(f"  Output table:         {OUTPUT_TABLE}")
    print(f"  Videos/channel:       {VIDEOS_PER_CHANNEL}")
    print(f"  Daily quota:          {DAILY_QUOTA_LIMIT:,}")
    est_cost = (len(DEV_CHANNEL_IDS) if DEV_CHANNEL_IDS else PRIORITY_SAMPLE_SIZE or 0) * (1 + VIDEOS_PER_CHANNEL / 50)
    print(f"  Est. enrich cost:     ~{est_cost:,.0f} units")
    print("=" * 60)
