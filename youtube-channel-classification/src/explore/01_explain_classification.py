# Databricks notebook source
# MAGIC %md
# MAGIC # Explain Channel Classification
# MAGIC
# MAGIC **Interactive notebook** — pick a channel and understand *why* it was classified
# MAGIC the way it was. Shows the full cosine similarity breakdown, visualizations, and
# MAGIC the text input that drove the classification.
# MAGIC
# MAGIC ## What This Notebook Shows
# MAGIC
# MAGIC 1. **Channel metadata** — title, text_input, assigned categories
# MAGIC 2. **Full similarity scores** — cosine similarity against all 698 IAB categories
# MAGIC 3. **Bar chart** — top 30 categories by similarity (assigned vs. rejected)
# MAGIC 4. **2D embedding map** — channel position relative to nearby IAB categories
# MAGIC 5. **Similarity heatmap** — channel vs. its assigned categories
# MAGIC 6. **Why these categories?** — plain-English explanation of the assignment

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

# MAGIC %md
# MAGIC ## Pick a Channel
# MAGIC
# MAGIC Enter a **channel title** (partial match) or **channel_id** (exact match).

# COMMAND ----------

dbutils.widgets.text("channel_query", "MKBHD", "Channel title or ID")
channel_query = dbutils.widgets.get("channel_query").strip()
print(f"Looking up: {channel_query}")

# COMMAND ----------

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import base64
import io as _io
from sklearn.decomposition import PCA
from pyspark.sql.functions import col, lit, lower, round as spark_round, desc, size

def show_plot(fig):
    """Render a matplotlib figure inline in Databricks using displayHTML."""
    buf = _io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    buf.seek(0)
    img_b64 = base64.b64encode(buf.read()).decode("utf-8")
    plt.close(fig)
    displayHTML(f'<img src="data:image/png;base64,{img_b64}" />')

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Find the Channel

# COMMAND ----------

df_output = spark.table(OUTPUT_TABLE)
df_prepped = spark.table(PREPPED_TABLE)
df_embeddings = spark.table(EMBEDDINGS_TABLE)

# Try exact channel_id match first, then title search
match = df_output.filter(col("channel_id") == channel_query)
if match.count() == 0:
    match = df_output.filter(lower(col("channel_title")).contains(channel_query.lower()))

if match.count() == 0:
    print(f"No channel found matching '{channel_query}'.")
    print("Try a different title or channel_id.")
    dbutils.notebook.exit(f"NOT FOUND: {channel_query}")

# Take first match
channel_row = match.first()
channel_id = channel_row.channel_id
channel_title = channel_row.channel_title

print(f"Found: {channel_title} ({channel_id})")
print(f"  Primary category: {channel_row.primary_category}")
print(f"  Primary confidence: {channel_row.primary_confidence:.4f}")
print(f"  Num categories: {channel_row.num_categories}")

if match.count() > 1:
    print(f"\n  ({match.count()} matches found — using first. Be more specific to pick a different one.)")
    display(match.select("channel_id", "channel_title", "primary_category", "num_categories").limit(10))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Channel Detail

# COMMAND ----------

# Get the text_input that was embedded
prepped_row = df_prepped.filter(col("channel_id") == channel_id).first()
text_input = prepped_row.text_input if prepped_row else "(not found in prepped table)"
text_length = prepped_row.text_length if prepped_row else 0

print(f"Channel: {channel_title}")
print(f"ID:      {channel_id}")
print(f"Text length: {text_length} chars")
print(f"\n{'='*60}")
print("TEXT INPUT (what was embedded):")
print(f"{'='*60}")
print(text_input[:2000])
if len(text_input) > 2000:
    print(f"\n... ({len(text_input) - 2000} more chars)")

# COMMAND ----------

# Show assigned categories
print(f"\nAssigned categories ({channel_row.num_categories}):")
print(f"{'='*60}")
for i, cat in enumerate(channel_row.categories):
    marker = "PRIMARY" if i == 0 else f"#{i+1}"
    print(f"  [{marker}] {cat.name} ({cat.tier_path}) — similarity: {cat.similarity:.4f}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Full Similarity Breakdown
# MAGIC
# MAGIC Compute cosine similarity between this channel and **all 698 IAB categories**.
# MAGIC This shows not just what matched, but what was close and what was far away.

# COMMAND ----------

# Load channel embedding
emb_row = df_embeddings.filter(col("channel_id") == channel_id).first()
channel_emb = np.array(emb_row.embedding, dtype=np.float32)

# Load all IAB category embeddings
df_iab = spark.table(IAB_EMBEDDINGS_TABLE)
df_taxonomy = spark.table(IAB_TAXONOMY_TABLE)

iab_rows = df_iab.select("unique_id", "name", "tier_path", "embedding").collect()
tier_info = {row.unique_id: row.tier_level for row in df_taxonomy.select("unique_id", "tier_level").collect()}

iab_ids = [r.unique_id for r in iab_rows]
iab_names = [r.name for r in iab_rows]
iab_paths = [r.tier_path for r in iab_rows]
iab_tiers = [tier_info.get(r.unique_id, 1) for r in iab_rows]
iab_embeddings = np.array([r.embedding for r in iab_rows], dtype=np.float32)

# Compute cosine similarity
channel_norm = channel_emb / np.linalg.norm(channel_emb)
iab_norms = iab_embeddings / np.linalg.norm(iab_embeddings, axis=1, keepdims=True)
similarities = (channel_norm.reshape(1, -1) @ iab_norms.T)[0]

# Build results dataframe
df_sims = pd.DataFrame({
    "iab_id": iab_ids,
    "category": iab_names,
    "tier_path": iab_paths,
    "tier_level": iab_tiers,
    "similarity": similarities,
}).sort_values("similarity", ascending=False).reset_index(drop=True)

df_sims["assigned"] = df_sims["similarity"] >= SIMILARITY_THRESHOLD
df_sims["rank"] = range(1, len(df_sims) + 1)

assigned_count = df_sims["assigned"].sum()
print(f"Categories above threshold ({SIMILARITY_THRESHOLD}): {assigned_count}")
print(f"Categories assigned (after cap at {MAX_CATEGORIES_PER_CHANNEL}): {min(assigned_count, MAX_CATEGORIES_PER_CHANNEL)}")

# COMMAND ----------

# Show top 30 with assignment status
print(f"\nTop 30 categories by similarity to '{channel_title}':")
display(
    spark.createDataFrame(df_sims.head(30)[["rank", "category", "tier_path", "tier_level", "similarity", "assigned"]])
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Similarity Bar Chart
# MAGIC
# MAGIC The top 30 categories by cosine similarity. Green bars are **assigned** categories
# MAGIC (above threshold), red bars are **rejected** (below threshold). The dashed line
# MAGIC shows the threshold.

# COMMAND ----------

top_n = 30
df_top = df_sims.head(top_n).copy()

fig, ax = plt.subplots(figsize=(12, 8))

colors = ["#2ecc71" if a else "#e74c3c" for a in df_top["assigned"]]
bars = ax.barh(range(len(df_top)), df_top["similarity"], color=colors, edgecolor="white", linewidth=0.5)

# Threshold line
ax.axvline(x=SIMILARITY_THRESHOLD, color="#2c3e50", linestyle="--", linewidth=1.5, label=f"Threshold ({SIMILARITY_THRESHOLD})")

# Labels
ax.set_yticks(range(len(df_top)))
ax.set_yticklabels([f"{row.category} (T{row.tier_level})" for _, row in df_top.iterrows()], fontsize=9)
ax.invert_yaxis()
ax.set_xlabel("Cosine Similarity", fontsize=11)
ax.set_title(f"Top {top_n} IAB Categories for '{channel_title}'", fontsize=13, fontweight="bold")
ax.legend(loc="lower right")

# Add similarity values on bars
for i, (_, row) in enumerate(df_top.iterrows()):
    ax.text(row.similarity + 0.005, i, f"{row.similarity:.3f}", va="center", fontsize=8)

plt.tight_layout()
show_plot(fig)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. 2D Embedding Map
# MAGIC
# MAGIC Reduce the 1024-dimensional embeddings to 2D using PCA. This shows where the
# MAGIC channel sits relative to IAB categories — nearby points mean higher similarity.

# COMMAND ----------

# Focus on assigned categories + a handful of nearby unassigned for context.
# PCA works best when the points are semantically close — including distant
# categories pushes everything apart and makes the map unreadable.

n_assigned = min(int(assigned_count), MAX_CATEGORIES_PER_CHANNEL)
n_context = 5  # a few unassigned neighbors for contrast
show_idx = df_sims.head(n_assigned + n_context).index.tolist()

show_embs = iab_embeddings[show_idx]
show_names = [iab_names[i] for i in show_idx]
show_assigned = [df_sims.loc[i, "assigned"] for i in show_idx]
show_sims = [float(df_sims.loc[i, "similarity"]) for i in show_idx]

all_embs = np.vstack([channel_emb.reshape(1, -1), show_embs])

pca = PCA(n_components=2, random_state=42)
coords = pca.fit_transform(all_embs)

from matplotlib.lines import Line2D

fig, ax = plt.subplots(figsize=(14, 10))

# Plot IAB categories
for i in range(1, len(coords)):
    is_assigned = show_assigned[i - 1]
    color = "#2ecc71" if is_assigned else "#95a5a6"
    marker_size = 120 if is_assigned else 60
    alpha = 1.0 if is_assigned else 0.5
    ax.scatter(coords[i, 0], coords[i, 1], c=color, s=marker_size, alpha=alpha,
               edgecolors="white", linewidth=0.8, zorder=3)

# Draw lines from channel to assigned categories
for i in range(1, len(coords)):
    if show_assigned[i - 1]:
        ax.plot(
            [coords[0, 0], coords[i, 0]],
            [coords[0, 1], coords[i, 1]],
            color="#2ecc71", alpha=0.4, linewidth=1.5, linestyle="--", zorder=2,
        )

# Plot channel (star marker)
ax.scatter(coords[0, 0], coords[0, 1], c="#e74c3c", s=300, marker="*",
           zorder=5, edgecolors="black", linewidth=0.8)

# Labels — offset to reduce overlap, include similarity score
texts_to_place = []
for i in range(1, len(coords)):
    sim_val = show_sims[i - 1]
    label = f"{show_names[i - 1]} ({sim_val:.2f})"
    color = "#2c3e50" if show_assigned[i - 1] else "#7f8c8d"
    fontweight = "bold" if show_assigned[i - 1] else "normal"
    fontsize = 8 if show_assigned[i - 1] else 7
    # Alternate offset direction based on position to reduce overlap
    x_off = 8 if coords[i, 0] >= coords[0, 0] else -8
    y_off = 8 if i % 2 == 0 else -8
    ha = "left" if x_off > 0 else "right"
    ax.annotate(label, (coords[i, 0], coords[i, 1]),
                fontsize=fontsize, color=color, fontweight=fontweight,
                xytext=(x_off, y_off), textcoords="offset points", ha=ha,
                arrowprops=dict(arrowstyle="-", color="#bdc3c7", linewidth=0.5))

# Channel label
ax.annotate(channel_title, (coords[0, 0], coords[0, 1]),
            fontsize=11, fontweight="bold", color="#e74c3c",
            xytext=(12, 12), textcoords="offset points",
            arrowprops=dict(arrowstyle="-", color="#e74c3c", linewidth=0.8))

ax.set_title(f"2D Embedding Map: '{channel_title}' vs Nearby IAB Categories", fontsize=13, fontweight="bold")
ax.set_xlabel(f"PCA Component 1 ({pca.explained_variance_ratio_[0]*100:.1f}% variance)", fontsize=10)
ax.set_ylabel(f"PCA Component 2 ({pca.explained_variance_ratio_[1]*100:.1f}% variance)", fontsize=10)

legend_elements = [
    Line2D([0], [0], marker="*", color="w", markerfacecolor="#e74c3c", markersize=15, label=f"Channel: {channel_title}"),
    Line2D([0], [0], marker="o", color="w", markerfacecolor="#2ecc71", markersize=10, label="Assigned category"),
    Line2D([0], [0], marker="o", color="w", markerfacecolor="#95a5a6", markersize=8, label="Near miss (not assigned)"),
]
ax.legend(handles=legend_elements, loc="best", fontsize=9, framealpha=0.9)
ax.grid(True, alpha=0.15)

plt.tight_layout()
show_plot(fig)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Similarity Heatmap
# MAGIC
# MAGIC Heatmap showing cosine similarity between this channel and its assigned categories.

# COMMAND ----------

assigned_cats = df_sims[df_sims["assigned"]].head(MAX_CATEGORIES_PER_CHANNEL)

if len(assigned_cats) > 1:
    # Get embeddings for assigned categories
    assigned_idx = assigned_cats.index.tolist()
    assigned_embs = iab_embeddings[assigned_idx]
    assigned_names = assigned_cats["category"].tolist()

    # Combine channel + assigned for cross-similarity
    all_vecs = np.vstack([channel_emb.reshape(1, -1), assigned_embs])
    all_labels = [f"{channel_title[:30]}"] + assigned_names

    # Normalize and compute pairwise similarity
    norms_h = np.linalg.norm(all_vecs, axis=1, keepdims=True)
    norms_h[norms_h == 0] = 1.0
    normed_h = all_vecs / norms_h
    sim_matrix = normed_h @ normed_h.T

    # Use data range for color scale so differences are visible
    off_diag = sim_matrix[np.triu_indices_from(sim_matrix, k=1)]
    vmin = max(0, float(off_diag.min()) - 0.05)
    vmax = min(1, float(off_diag.max()) + 0.05)

    n_labels = len(all_labels)
    fig_w = max(10, n_labels * 0.9 + 3)
    fig_h = max(8, n_labels * 0.7 + 3)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))

    im = ax.imshow(sim_matrix, cmap="RdYlGn", vmin=vmin, vmax=vmax)

    ax.set_xticks(range(n_labels))
    ax.set_yticks(range(n_labels))
    ax.set_xticklabels(all_labels, rotation=50, ha="right", fontsize=8)
    ax.set_yticklabels(all_labels, fontsize=8)

    # Add values — use contrasting text colors
    mid = (vmin + vmax) / 2
    for i in range(n_labels):
        for j in range(n_labels):
            val = sim_matrix[i, j]
            text_color = "white" if val < (mid - 0.05) else "black"
            ax.text(j, i, f"{val:.2f}", ha="center", va="center", fontsize=7, color=text_color)

    # Highlight the channel row/column
    for i in range(n_labels):
        ax.add_patch(plt.Rectangle((i - 0.5, -0.5), 1, 1, fill=False, edgecolor="#e74c3c", linewidth=1.5))
        ax.add_patch(plt.Rectangle((-0.5, i - 0.5), 1, 1, fill=False, edgecolor="#e74c3c", linewidth=1.5))

    plt.colorbar(im, ax=ax, label="Cosine Similarity", shrink=0.8)
    ax.set_title(f"Similarity Heatmap: '{channel_title}' & Assigned Categories", fontsize=12, fontweight="bold", pad=15)
    plt.tight_layout()
    fig.subplots_adjust(bottom=0.2)
    show_plot(fig)
else:
    print(f"Only {len(assigned_cats)} category assigned — heatmap needs at least 2.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. Similarity Distribution
# MAGIC
# MAGIC Histogram of this channel's similarity scores across all 698 categories.
# MAGIC Most categories should be near zero; assigned categories are in the right tail.

# COMMAND ----------

fig, ax = plt.subplots(figsize=(10, 5))

ax.hist(df_sims["similarity"], bins=50, color="#3498db", alpha=0.7, edgecolor="white")
ax.axvline(x=SIMILARITY_THRESHOLD, color="#e74c3c", linestyle="--", linewidth=2, label=f"Threshold ({SIMILARITY_THRESHOLD})")

# Mark assigned categories
for _, row in assigned_cats.iterrows():
    ax.axvline(x=row.similarity, color="#2ecc71", alpha=0.5, linewidth=1)

ax.set_xlabel("Cosine Similarity", fontsize=11)
ax.set_ylabel("Number of IAB Categories", fontsize=11)
ax.set_title(f"Similarity Distribution: '{channel_title}' vs All 698 Categories", fontsize=13, fontweight="bold")
ax.legend()

plt.tight_layout()
show_plot(fig)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 8. Plain-English Explanation

# COMMAND ----------

print(f"{'='*60}")
print(f"CLASSIFICATION EXPLANATION: {channel_title}")
print(f"{'='*60}")
print()
print(f"This channel was classified using cosine similarity between its")
print(f"text embedding and {len(iab_ids)} IAB Content Taxonomy category embeddings.")
print()
print(f"TEXT INPUT ({text_length} chars):")
print(f"  The embedded text was built from the channel's title, description,")
print(f"  keywords, and topic categories. Longer, richer text produces better")
print(f"  embeddings and more confident classifications.")
print()

# Primary category explanation
primary = df_sims.iloc[0]
print(f"PRIMARY CATEGORY: {primary.category}")
print(f"  Tier path:   {primary.tier_path}")
print(f"  Similarity:  {primary.similarity:.4f}")
print(f"  This is the highest-scoring category — the channel's text is most")
print(f"  semantically similar to this category's description.")
print()

# All assigned
print(f"ALL ASSIGNED ({min(assigned_count, MAX_CATEGORIES_PER_CHANNEL)} categories above threshold {SIMILARITY_THRESHOLD}):")
for i, (_, row) in enumerate(assigned_cats.iterrows()):
    print(f"  {i+1}. {row.category} (T{row.tier_level}) — {row.similarity:.4f}")
print()

# Near misses
near_miss = df_sims[(df_sims["similarity"] < SIMILARITY_THRESHOLD) & (df_sims["similarity"] >= SIMILARITY_THRESHOLD - 0.05)]
if len(near_miss) > 0:
    print(f"NEAR MISSES (within 0.05 of threshold):")
    for _, row in near_miss.head(5).iterrows():
        print(f"  - {row.category} ({row.tier_path}) — {row.similarity:.4f}")
    print(f"  These categories narrowly missed. Lowering the threshold to")
    print(f"  {SIMILARITY_THRESHOLD - 0.05} would include them.")
    print()

# Bottom categories
print(f"LEAST SIMILAR CATEGORIES (bottom 5):")
for _, row in df_sims.tail(5).iterrows():
    print(f"  - {row.category} — {row.similarity:.4f}")
print()

# Summary stats
print(f"DISTRIBUTION:")
print(f"  Mean similarity:   {df_sims['similarity'].mean():.4f}")
print(f"  Median similarity: {df_sims['similarity'].median():.4f}")
print(f"  Max similarity:    {df_sims['similarity'].max():.4f}")
print(f"  Min similarity:    {df_sims['similarity'].min():.4f}")
print(f"  Std dev:           {df_sims['similarity'].std():.4f}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 9. Compare Multiple Channels (Optional)
# MAGIC
# MAGIC Enter comma-separated channel titles to compare their similarity profiles.

# COMMAND ----------

dbutils.widgets.text("compare_channels", "", "Compare channels (comma-separated titles)")
compare_input = dbutils.widgets.get("compare_channels").strip()

if compare_input:
    compare_titles = [t.strip() for t in compare_input.split(",") if t.strip()]

    compare_data = []
    for title in compare_titles:
        ch = df_output.filter(lower(col("channel_title")).contains(title.lower())).first()
        if ch:
            emb = df_embeddings.filter(col("channel_id") == ch.channel_id).first()
            if emb:
                compare_data.append({"title": ch.channel_title, "id": ch.channel_id, "embedding": np.array(emb.embedding, dtype=np.float32)})
                print(f"Found: {ch.channel_title} → {ch.primary_category} ({ch.primary_confidence:.3f})")
            else:
                print(f"No embedding for: {title}")
        else:
            print(f"Not found: {title}")

    if len(compare_data) >= 2:
        # Pairwise similarity between channels
        embs = np.array([d["embedding"] for d in compare_data])
        norms = np.linalg.norm(embs, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        normed = embs / norms
        sim_matrix = normed @ normed.T

        labels = [d["title"][:30] for d in compare_data]

        fig, ax = plt.subplots(figsize=(8, 6))
        im = ax.imshow(sim_matrix, cmap="YlOrRd", vmin=0, vmax=1)
        ax.set_xticks(range(len(labels)))
        ax.set_yticks(range(len(labels)))
        ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=9)
        ax.set_yticklabels(labels, fontsize=9)
        for i in range(len(labels)):
            for j in range(len(labels)):
                text_color = "white" if sim_matrix[i, j] > 0.7 else "black"
                ax.text(j, i, f"{sim_matrix[i, j]:.3f}", ha="center", va="center", fontsize=9, color=text_color)
        plt.colorbar(im, ax=ax, label="Cosine Similarity")
        ax.set_title("Channel-to-Channel Similarity", fontsize=13, fontweight="bold")
        plt.tight_layout()
        show_plot(fig)
else:
    print("Enter comma-separated channel titles in the 'compare_channels' widget to compare.")
    print("Example: MKBHD, CoComelon, MrBeast")
