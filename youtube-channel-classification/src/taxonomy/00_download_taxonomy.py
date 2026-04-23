# Databricks notebook source
# MAGIC %md
# MAGIC # Download IAB Content Taxonomy v3.0
# MAGIC
# MAGIC Downloads the IAB Content Taxonomy v3.0 TSV directly from GitHub and saves
# MAGIC it as a Delta table. This eliminates the need to manually upload the TSV
# MAGIC file to Volumes.
# MAGIC
# MAGIC **Idempotent:** Skips if the raw taxonomy table already exists with data.
# MAGIC Set `force_rebuild = True` to re-download.
# MAGIC
# MAGIC **Source:** [InteractiveAdvertisingBureau/Taxonomies](https://github.com/InteractiveAdvertisingBureau/Taxonomies)
# MAGIC (CC-BY-3.0 license)
# MAGIC
# MAGIC **Output:** `iab_taxonomy_raw` Delta table — parsed, cleaned, with tier_level,
# MAGIC tier_path, and is_sensitive columns.

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

import io
import requests
import pandas as pd
from pyspark.sql.functions import col, lit, concat_ws, when

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Check Idempotency

# COMMAND ----------

force_rebuild = False

def raw_table_exists():
    """Check if the raw taxonomy table already exists with data."""
    try:
        count = spark.table(IAB_TAXONOMY_RAW_TABLE).count()
        if count > 0:
            print(f"Raw taxonomy table exists: {count} rows")
            return True
    except Exception:
        pass
    return False

if raw_table_exists() and not force_rebuild:
    print(f"Raw taxonomy already loaded in {IAB_TAXONOMY_RAW_TABLE}.")
    print("Set force_rebuild = True to re-download.")
    dbutils.notebook.exit("SKIPPED — raw taxonomy table already exists")

print("Downloading IAB taxonomy from GitHub...")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Download TSV from GitHub

# COMMAND ----------

print(f"URL: {IAB_TAXONOMY_URL}")

response = requests.get(IAB_TAXONOMY_URL, timeout=30)
response.raise_for_status()

print(f"Downloaded {len(response.content):,} bytes")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Parse TSV

# COMMAND ----------

# Read TSV into pandas
df_pd = pd.read_csv(io.StringIO(response.text), sep="\t", dtype=str)

# Rename columns to clean names
column_mapping = {
    df_pd.columns[0]: "unique_id",
    df_pd.columns[1]: "parent_id",
    df_pd.columns[2]: "name",
    df_pd.columns[3]: "tier_1",
    df_pd.columns[4]: "tier_2",
    df_pd.columns[5]: "tier_3",
    df_pd.columns[6]: "tier_4",
}
if len(df_pd.columns) > 7:
    column_mapping[df_pd.columns[7]] = "extension"

df_pd = df_pd.rename(columns=column_mapping)

# Drop the duplicate header row (contains "Unique ID", "Parent", etc.)
df_pd = df_pd[df_pd["unique_id"] != "Unique ID"].reset_index(drop=True)

# Replace empty strings with None
df_pd = df_pd.replace("", None)

print(f"Parsed {len(df_pd)} categories")
print(f"Columns: {list(df_pd.columns)}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Add Computed Columns

# COMMAND ----------

# Convert to Spark DataFrame
df = spark.createDataFrame(df_pd)

# Compute tier level
df = df.withColumn(
    "tier_level",
    when(col("tier_4").isNotNull(), lit(4))
    .when(col("tier_3").isNotNull(), lit(3))
    .when(col("tier_2").isNotNull(), lit(2))
    .otherwise(lit(1))
)

# Compute tier path
df = df.withColumn(
    "tier_path",
    when(col("tier_4").isNotNull(),
         concat_ws(" > ", col("tier_1"), col("tier_2"), col("tier_3"), col("tier_4")))
    .when(col("tier_3").isNotNull(),
         concat_ws(" > ", col("tier_1"), col("tier_2"), col("tier_3")))
    .when(col("tier_2").isNotNull(),
         concat_ws(" > ", col("tier_1"), col("tier_2")))
    .otherwise(col("tier_1"))
)

# Flag sensitive content categories (SCD)
if "extension" in df.columns:
    df = df.withColumn("is_sensitive", col("extension").contains("SCD"))
else:
    df = df.withColumn("is_sensitive", lit(False))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Save to Delta

# COMMAND ----------

df.write.format("delta").mode("overwrite").saveAsTable(IAB_TAXONOMY_RAW_TABLE)

total = df.count()
print(f"Saved to {IAB_TAXONOMY_RAW_TABLE}: {total} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Validate

# COMMAND ----------

df_check = spark.table(IAB_TAXONOMY_RAW_TABLE)

print(f"Table:      {IAB_TAXONOMY_RAW_TABLE}")
print(f"Rows:       {df_check.count()}")
print(f"Columns:    {df_check.columns}")

# Tier distribution
print("\nCategories per tier:")
display(
    df_check.groupBy("tier_level")
    .count()
    .orderBy("tier_level")
)

# Sensitive categories
sensitive = df_check.filter(col("is_sensitive") == True).count()
print(f"\nSensitive content categories (SCD): {sensitive}")

# Sample rows
print("\nSample categories:")
display(df_check.select("unique_id", "name", "tier_path", "tier_level", "is_sensitive").limit(10))
