# Databricks notebook source
# MAGIC %md
# MAGIC # Taxonomy Preparation: IAB Content Taxonomy v3.0
# MAGIC
# MAGIC **Purpose:** Prepare the IAB Content Taxonomy for use as classification reference.
# MAGIC This is a one-time (idempotent) step that:
# MAGIC
# MAGIC 1. Loads the IAB Content Taxonomy v3.0 TSV (698 categories across 4 tiers)
# MAGIC 2. Generates rich descriptions for each category using an LLM
# MAGIC 3. Embeds all category descriptions using the same model as channel embeddings
# MAGIC 4. Saves to Delta tables for use by the classification pipeline
# MAGIC
# MAGIC **Idempotent:** Skips if tables already exist with expected row counts.
# MAGIC Re-run with `force_rebuild = True` to regenerate.
# MAGIC
# MAGIC **Input:** `iab_taxonomy_raw` Delta table (from `00_download_taxonomy.py`)
# MAGIC **Output:** `iab_taxonomy` table + `iab_taxonomy_embeddings` table

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

import mlflow.deployments
import pandas as pd
import numpy as np
import time
from pyspark.sql import functions as F
from pyspark.sql.functions import col, lit
from pyspark.sql.types import (
    StructType, StructField, StringType, IntegerType, ArrayType, FloatType,
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Check Idempotency
# MAGIC
# MAGIC Skip if tables already exist and have the expected row count.
# MAGIC Set `force_rebuild = True` to regenerate.

# COMMAND ----------

force_rebuild = False

def tables_exist():
    """Check if taxonomy tables already exist with data."""
    try:
        tax_count = spark.table(IAB_TAXONOMY_TABLE).count()
        emb_count = spark.table(IAB_EMBEDDINGS_TABLE).count()
        if tax_count > 0 and emb_count > 0 and tax_count == emb_count:
            print(f"Taxonomy tables exist: {tax_count} categories, {emb_count} embeddings")
            return True
    except Exception:
        pass
    return False

if tables_exist() and not force_rebuild:
    print("Taxonomy already prepared. Set force_rebuild = True to regenerate.")
    dbutils.notebook.exit("SKIPPED — taxonomy tables already exist")

print("Preparing taxonomy from scratch...")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Load IAB Taxonomy from Raw Table
# MAGIC
# MAGIC Reads from the `iab_taxonomy_raw` Delta table (created by `00_download_taxonomy.py`).
# MAGIC The raw table already has clean column names, tier_level, tier_path, and is_sensitive.

# COMMAND ----------

df_taxonomy = spark.table(IAB_TAXONOMY_RAW_TABLE)

total_categories = df_taxonomy.count()
print(f"Loaded {total_categories} categories from {IAB_TAXONOMY_RAW_TABLE}")

# COMMAND ----------

display(
    df_taxonomy.groupBy("tier_level")
    .count()
    .orderBy("tier_level")
)

# COMMAND ----------

# Show Tier 1 categories
display(
    df_taxonomy.filter(col("tier_level") == 1)
    .select("unique_id", "name", "is_sensitive")
    .orderBy("name")
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Generate Category Descriptions with LLM
# MAGIC
# MAGIC For each IAB category, we use an LLM to generate a rich 2-3 sentence
# MAGIC description of what YouTube channels in that category typically produce.
# MAGIC
# MAGIC **Why?** Embedding just the category name (e.g., "Basketball") produces
# MAGIC a weaker vector than embedding a rich description. The description helps
# MAGIC the embedding model understand the full semantic scope of each category.
# MAGIC
# MAGIC **Cost:** ~698 LLM calls, one-time. ~$1-2 total.

# COMMAND ----------

client = mlflow.deployments.get_deploy_client("databricks")

def generate_description(name, tier_path, tier_level):
    """Generate a rich description for an IAB category using LLM."""
    if tier_level == 1:
        context = f"the broad top-level category '{name}'"
    else:
        context = f"'{name}' (part of the hierarchy: {tier_path})"

    prompt = f"""You are helping classify YouTube channels into IAB Content Taxonomy categories.

Write a 2-3 sentence description of {context}. Describe what YouTube channels in this category typically produce — topics covered, content formats, and target audience. Be specific and include example content types.

Respond with ONLY the description, no preamble."""

    try:
        resp = client.predict(
            endpoint=IAB_DESCRIPTION_MODEL,
            inputs={
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 200,
                "temperature": 0.3,
            },
        )
        return resp["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"  Error for '{name}': {e}")
        return f"Content related to {tier_path}."

# COMMAND ----------

# Collect taxonomy to driver for LLM calls (698 rows is small)
taxonomy_rows = df_taxonomy.select(
    "unique_id", "name", "tier_path", "tier_level"
).collect()

print(f"Generating descriptions for {len(taxonomy_rows)} categories...")
print("This takes ~5-10 minutes for the full taxonomy.")
print("-" * 60)

descriptions = {}
for i, row in enumerate(taxonomy_rows):
    desc = generate_description(row.name, row.tier_path, row.tier_level)
    descriptions[row.unique_id] = desc

    if (i + 1) % 50 == 0:
        print(f"  [{i+1}/{len(taxonomy_rows)}] Last: {row.name[:40]} → {desc[:80]}...")

print(f"\nGenerated {len(descriptions)} descriptions")

# COMMAND ----------

# Show a few examples
for uid in list(descriptions.keys())[:5]:
    row = next(r for r in taxonomy_rows if r.unique_id == uid)
    print(f"\n{row.tier_path}:")
    print(f"  {descriptions[uid]}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Embed Category Descriptions
# MAGIC
# MAGIC Using the same embedding model as channel embeddings (`databricks-gte-large-en`)
# MAGIC ensures that channel vectors and category vectors live in the same vector space
# MAGIC and can be compared via cosine similarity.

# COMMAND ----------

def embed_texts_batch(texts, batch_size=50):
    """Embed a list of texts using the Foundation Model API."""
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        try:
            resp = client.predict(
                endpoint=EMBEDDING_MODEL_FMAPI,
                inputs={"input": batch},
            )
            batch_embs = [item["embedding"] for item in resp["data"]]
            all_embeddings.extend(batch_embs)
        except Exception as e:
            print(f"  Embedding error at batch {i}: {e}")
            all_embeddings.extend([[0.0] * EMBEDDING_DIMENSION] * len(batch))
        if i > 0 and i % 200 == 0:
            print(f"  Embedded {i}/{len(texts)} categories...")
    return all_embeddings

# Build texts to embed: tier_path + description for richer context
texts_to_embed = []
uid_order = []
for row in taxonomy_rows:
    desc = descriptions.get(row.unique_id, f"Content related to {row.tier_path}.")
    text = f"{row.tier_path}. {desc}"
    texts_to_embed.append(text)
    uid_order.append(row.unique_id)

print(f"Embedding {len(texts_to_embed)} category descriptions...")
embeddings = embed_texts_batch(texts_to_embed)
print(f"Generated {len(embeddings)} embeddings of dimension {len(embeddings[0])}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Save to Delta Tables

# COMMAND ----------

# Add descriptions to taxonomy DataFrame
desc_rows = [(uid, descriptions.get(uid, "")) for uid in uid_order]
df_desc = spark.createDataFrame(desc_rows, ["unique_id", "description"])

df_taxonomy_final = df_taxonomy.join(df_desc, on="unique_id", how="left")

df_taxonomy_final.write.format("delta").mode("overwrite").saveAsTable(IAB_TAXONOMY_TABLE)
print(f"Saved taxonomy to {IAB_TAXONOMY_TABLE}: {df_taxonomy_final.count()} rows")

# COMMAND ----------

# Save embeddings
emb_rows = [
    (uid_order[i], taxonomy_rows[i].name, taxonomy_rows[i].tier_path, embeddings[i])
    for i in range(len(uid_order))
]

schema = StructType([
    StructField("unique_id", StringType(), False),
    StructField("name", StringType(), False),
    StructField("tier_path", StringType(), False),
    StructField("embedding", ArrayType(FloatType()), False),
])

df_emb = spark.createDataFrame(emb_rows, schema)
df_emb.write.format("delta").mode("overwrite").saveAsTable(IAB_EMBEDDINGS_TABLE)
print(f"Saved embeddings to {IAB_EMBEDDINGS_TABLE}: {df_emb.count()} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Validate

# COMMAND ----------

df_tax = spark.table(IAB_TAXONOMY_TABLE)
df_emb_check = spark.table(IAB_EMBEDDINGS_TABLE)

print(f"Taxonomy table:   {df_tax.count()} categories")
print(f"Embeddings table: {df_emb_check.count()} embeddings")
print(f"Embedding dim:    {len(df_emb_check.first().embedding)}")

# Tier distribution
print("\nCategories per tier:")
display(df_tax.groupBy("tier_level").count().orderBy("tier_level"))

# Sensitive categories
sensitive = df_tax.filter(col("is_sensitive") == True).count()
print(f"\nSensitive content categories (SCD): {sensitive}")

# Sample descriptions
print("\nSample descriptions:")
display(
    df_tax.select("tier_path", "description", "tier_level", "is_sensitive")
    .orderBy(F.rand(seed=42))
    .limit(10)
)
