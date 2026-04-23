# Databricks notebook source
# MAGIC %md
# MAGIC # Pre-compute Visualization Data for Embeddings Explorer App
# MAGIC
# MAGIC Runs once to produce the tables the Embeddings Explorer Databricks App reads at runtime.
# MAGIC
# MAGIC **Outputs:**
# MAGIC | Table | Rows | Purpose |
# MAGIC |-------|------|---------|
# MAGIC | `iab_viz_precomputed` | 698 | IAB categories + 3D coords + clusters |
# MAGIC | `channels_viz_sample` | 5000 | Channel sample + 3D coords |
# MAGIC | `viz_dendrogram_linkage` | 1 | Serialized scipy linkage matrix |

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Load IAB Taxonomy Data

# COMMAND ----------

import numpy as np
import pandas as pd
import json

df_iab_emb = spark.table(IAB_EMBEDDINGS_TABLE)
df_taxonomy = spark.table(IAB_TAXONOMY_TABLE)

# Join to get full metadata
df_iab = (
    df_iab_emb.alias("e")
    .join(df_taxonomy.alias("t"), "unique_id")
    .select(
        "e.unique_id", "e.name", "e.tier_path", "e.embedding",
        "t.tier_level", "t.description",
    )
)

iab_count = df_iab.count()
print(f"IAB categories loaded: {iab_count}")

# COMMAND ----------

# Collect to pandas for sklearn
pdf_iab = df_iab.toPandas()
embeddings = np.array(pdf_iab["embedding"].tolist(), dtype=np.float32)
print(f"Embedding matrix: {embeddings.shape}")

# Extract Tier 1 parent from tier_path (first segment)
pdf_iab["tier_1_parent"] = pdf_iab["tier_path"].apply(lambda p: p.split(" > ")[0] if p else "Unknown")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. t-SNE 3D Projection

# COMMAND ----------

from sklearn.manifold import TSNE

print("Running t-SNE (3D)...")
tsne = TSNE(n_components=3, perplexity=30, random_state=42, n_iter=1000, learning_rate="auto")
tsne_coords = tsne.fit_transform(embeddings)
print(f"t-SNE complete: {tsne_coords.shape}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. UMAP 3D Projection

# COMMAND ----------

# Install umap if needed
%pip install umap-learn hdbscan --quiet
dbutils.library.restartPython()

# COMMAND ----------

# Re-import after restart
import numpy as np
import pandas as pd
import json

# MAGIC %run ../config

# Re-load data
df_iab_emb = spark.table(IAB_EMBEDDINGS_TABLE)
df_taxonomy = spark.table(IAB_TAXONOMY_TABLE)
df_iab = (
    df_iab_emb.alias("e")
    .join(df_taxonomy.alias("t"), "unique_id")
    .select("e.unique_id", "e.name", "e.tier_path", "e.embedding", "t.tier_level", "t.description")
)
pdf_iab = df_iab.toPandas()
embeddings = np.array(pdf_iab["embedding"].tolist(), dtype=np.float32)
pdf_iab["tier_1_parent"] = pdf_iab["tier_path"].apply(lambda p: p.split(" > ")[0] if p else "Unknown")

# Re-run t-SNE (needed after restart)
from sklearn.manifold import TSNE
tsne = TSNE(n_components=3, perplexity=30, random_state=42, n_iter=1000, learning_rate="auto")
tsne_coords = tsne.fit_transform(embeddings)

# COMMAND ----------

import umap

print("Running UMAP (3D)...")
umap_model = umap.UMAP(n_components=3, n_neighbors=15, min_dist=0.1, random_state=42)
umap_coords = umap_model.fit_transform(embeddings)
print(f"UMAP complete: {umap_coords.shape}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. KMeans Clustering

# COMMAND ----------

from sklearn.cluster import KMeans

print("Running KMeans (k=30)...")
kmeans = KMeans(n_clusters=30, random_state=42, n_init=10)
kmeans_labels = kmeans.fit_predict(embeddings)
print(f"KMeans clusters: {len(set(kmeans_labels))}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. HDBSCAN Clustering

# COMMAND ----------

import hdbscan

print("Running HDBSCAN...")
hdb = hdbscan.HDBSCAN(min_cluster_size=5, min_samples=3)
hdbscan_labels = hdb.fit_predict(embeddings)
n_clusters = len(set(hdbscan_labels)) - (1 if -1 in hdbscan_labels else 0)
n_noise = (hdbscan_labels == -1).sum()
print(f"HDBSCAN clusters: {n_clusters}, noise points: {n_noise}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Dendrogram Linkage Matrix

# COMMAND ----------

from scipy.cluster.hierarchy import linkage
from scipy.spatial.distance import pdist

print("Computing Ward linkage for dendrogram...")
dist_matrix = pdist(embeddings, metric="cosine")
linkage_matrix = linkage(dist_matrix, method="ward")
linkage_json = json.dumps(linkage_matrix.tolist())
print(f"Linkage matrix shape: {linkage_matrix.shape}")
print(f"JSON size: {len(linkage_json):,} bytes")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. Normalize Coordinates to [-50, 50]

# COMMAND ----------

def normalize_coords(coords, range_min=-50, range_max=50):
    """Normalize coordinate array to [range_min, range_max]."""
    mins = coords.min(axis=0)
    maxs = coords.max(axis=0)
    scale = maxs - mins
    scale[scale == 0] = 1.0
    return (coords - mins) / scale * (range_max - range_min) + range_min

tsne_normed = normalize_coords(tsne_coords)
umap_normed = normalize_coords(umap_coords)

print(f"t-SNE range: [{tsne_normed.min():.1f}, {tsne_normed.max():.1f}]")
print(f"UMAP range:  [{umap_normed.min():.1f}, {umap_normed.max():.1f}]")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 8. Assemble IAB Viz Table

# COMMAND ----------

pdf_iab["tsne_x"] = tsne_normed[:, 0].astype(float)
pdf_iab["tsne_y"] = tsne_normed[:, 1].astype(float)
pdf_iab["tsne_z"] = tsne_normed[:, 2].astype(float)
pdf_iab["umap_x"] = umap_normed[:, 0].astype(float)
pdf_iab["umap_y"] = umap_normed[:, 1].astype(float)
pdf_iab["umap_z"] = umap_normed[:, 2].astype(float)
pdf_iab["cluster_kmeans"] = kmeans_labels.astype(int)
pdf_iab["cluster_hdbscan"] = hdbscan_labels.astype(int)

# Convert embedding list to native Python list for Spark
pdf_iab["embedding"] = pdf_iab["embedding"].apply(lambda x: [float(v) for v in x])


print(f"IAB viz table: {len(pdf_iab)} rows, {len(pdf_iab.columns)} columns")
print(f"Columns: {list(pdf_iab.columns)}")

# COMMAND ----------

# Save IAB viz table
VIZ_IAB_TABLE = f"{CATALOG}.{SCHEMA}.iab_viz_precomputed"

from pyspark.sql.types import (
    StructType, StructField, StringType, IntegerType, FloatType, ArrayType
)

schema = StructType([
    StructField("unique_id", StringType(), False),
    StructField("name", StringType(), False),
    StructField("tier_path", StringType(), True),
    StructField("embedding", ArrayType(FloatType()), False),
    StructField("tier_level", IntegerType(), True),
    StructField("description", StringType(), True),
    StructField("tier_1_parent", StringType(), True),
    StructField("tsne_x", FloatType(), False),
    StructField("tsne_y", FloatType(), False),
    StructField("tsne_z", FloatType(), False),
    StructField("umap_x", FloatType(), False),
    StructField("umap_y", FloatType(), False),
    StructField("umap_z", FloatType(), False),
    StructField("cluster_kmeans", IntegerType(), False),
    StructField("cluster_hdbscan", IntegerType(), False),
])

df_viz = spark.createDataFrame(pdf_iab, schema=schema)
df_viz.write.format("delta").mode("overwrite").saveAsTable(VIZ_IAB_TABLE)
print(f"Saved {VIZ_IAB_TABLE}: {df_viz.count()} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 9. Sample 5000 Channels

# COMMAND ----------

# Load channel data
df_channels_emb = spark.table(EMBEDDINGS_TABLE)
df_channels_out = spark.table(OUTPUT_TABLE)
df_channels_prep = spark.table(PREPPED_TABLE)

total_channels = df_channels_emb.count()
sample_n = min(5000, total_channels)
print(f"Total channels: {total_channels:,}, sampling: {sample_n}")

# Sample and join
from pyspark.sql import functions as F

df_sample = (
    df_channels_emb
    .orderBy(F.rand(seed=42))
    .limit(sample_n)
    .alias("e")
    .join(
        df_channels_out.select("channel_id", "channel_title", "primary_category", "primary_confidence").alias("o"),
        "channel_id",
        "left"
    )
    .join(
        df_channels_prep.select("channel_id", F.substring("text_input", 1, 200).alias("text_input")).alias("p"),
        "channel_id",
        "left"
    )
    .select(
        "e.channel_id", "o.channel_title", "o.primary_category",
        "o.primary_confidence", "p.text_input", "e.embedding",
    )
)

pdf_sample = df_sample.toPandas()
print(f"Sampled channels: {len(pdf_sample)}")

# COMMAND ----------

# Project channels through UMAP transform
channel_embeddings = np.array(pdf_sample["embedding"].tolist(), dtype=np.float32)

# UMAP transform for new points
print("Projecting channels through UMAP...")
channel_umap = umap_model.transform(channel_embeddings)
channel_umap_normed = normalize_coords(channel_umap)

# For t-SNE, use weighted KNN interpolation (can't transform new points)
# Find 5 nearest IAB categories for each channel, place at weighted centroid
from sklearn.metrics.pairwise import cosine_similarity

print("Computing t-SNE positions via KNN interpolation...")
iab_embs_normed = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
chan_embs_normed = channel_embeddings / np.linalg.norm(channel_embeddings, axis=1, keepdims=True)

# Process in batches to avoid memory issues
batch_size = 500
channel_tsne = np.zeros((len(pdf_sample), 3), dtype=np.float32)

for start in range(0, len(pdf_sample), batch_size):
    end = min(start + batch_size, len(pdf_sample))
    sims = chan_embs_normed[start:end] @ iab_embs_normed.T  # (batch, 698)
    for i in range(end - start):
        top_k_idx = np.argsort(sims[i])[-5:]  # top 5
        top_k_sims = sims[i][top_k_idx]
        weights = top_k_sims / top_k_sims.sum()
        channel_tsne[start + i] = (weights[:, None] * tsne_normed[top_k_idx]).sum(axis=0)

print(f"Channel projections complete")

# COMMAND ----------

pdf_sample["tsne_x"] = channel_tsne[:, 0].astype(float)
pdf_sample["tsne_y"] = channel_tsne[:, 1].astype(float)
pdf_sample["tsne_z"] = channel_tsne[:, 2].astype(float)
pdf_sample["umap_x"] = channel_umap_normed[:, 0].astype(float)
pdf_sample["umap_y"] = channel_umap_normed[:, 1].astype(float)
pdf_sample["umap_z"] = channel_umap_normed[:, 2].astype(float)
pdf_sample["embedding"] = pdf_sample["embedding"].apply(lambda x: [float(v) for v in x])

VIZ_CHANNELS_TABLE = f"{CATALOG}.{SCHEMA}.channels_viz_sample"

df_ch_viz = spark.createDataFrame(pdf_sample)
df_ch_viz.write.format("delta").mode("overwrite").saveAsTable(VIZ_CHANNELS_TABLE)
print(f"Saved {VIZ_CHANNELS_TABLE}: {df_ch_viz.count()} rows")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 10. Save Dendrogram Linkage

# COMMAND ----------

VIZ_DENDRO_TABLE = f"{CATALOG}.{SCHEMA}.viz_dendrogram_linkage"

pdf_dendro = pd.DataFrame({"linkage_json": [linkage_json]})
df_dendro = spark.createDataFrame(pdf_dendro)
df_dendro.write.format("delta").mode("overwrite").saveAsTable(VIZ_DENDRO_TABLE)
print(f"Saved {VIZ_DENDRO_TABLE}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Summary

# COMMAND ----------

print("=" * 60)
print("Pre-computation complete!")
print("=" * 60)
print(f"  {VIZ_IAB_TABLE}: {iab_count} IAB categories")
print(f"  {VIZ_CHANNELS_TABLE}: {sample_n} channel samples")
print(f"  {VIZ_DENDRO_TABLE}: dendrogram linkage matrix")
print()
print("3D projections: t-SNE + UMAP (both normalized to [-50, 50])")
print(f"Clustering: KMeans (k=30), HDBSCAN ({n_clusters} clusters)")
print(f"Dendrogram: Ward linkage, {len(linkage_json):,} bytes JSON")
