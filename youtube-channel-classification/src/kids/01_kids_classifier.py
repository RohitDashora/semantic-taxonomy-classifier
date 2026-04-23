# Databricks notebook source
# MAGIC %md
# MAGIC # Kids Classifier (Independent)
# MAGIC
# MAGIC Semi-supervised classifier that identifies Kids/Children's content channels.
# MAGIC Uses seed labels (API flags + optional seed list) to train a Logistic Regression
# MAGIC model on pre-computed embeddings, then scores all channels.
# MAGIC
# MAGIC **This is an independent process** — it does not affect the main IAB classification
# MAGIC pipeline. It adds `probability_kids` and `predicted_kids` columns to the output
# MAGIC table as supplementary signals for brand safety filtering.
# MAGIC
# MAGIC ## How It Works
# MAGIC
# MAGIC 1. Build training labels from YouTube API flags (`madeForKids`, `selfDeclaredMadeForKids`)
# MAGIC 2. Downsample negatives (2:1 ratio) to handle class imbalance
# MAGIC 3. Train Logistic Regression on pre-computed embeddings (~210K training rows max)
# MAGIC 4. Score all channels using distributed `pandas_udf` (never collects full dataset)
# MAGIC 5. Write kids scores table
# MAGIC
# MAGIC **Input:** Channel embeddings + raw channel data (for Kids labels)
# MAGIC **Output:** Kids scores table (channel_id, probability_kids, predicted_kids)

# COMMAND ----------

# MAGIC %run ../config

# COMMAND ----------

print_config()

# COMMAND ----------

import pickle
import mlflow
import mlflow.sklearn
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
from pyspark.sql import functions as F
from pyspark.sql.functions import col, when, lit, coalesce, lower, pandas_udf
from pyspark.sql.types import FloatType

# COMMAND ----------

mlflow.set_experiment(MLFLOW_EXPERIMENT_NAME)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Build Training Labels
# MAGIC
# MAGIC Compute kids labels directly from the raw data — this notebook is self-contained
# MAGIC and does not depend on the classification pipeline's prepped table.

# COMMAND ----------

# Load raw channel data for kids labels
if DATA_SOURCE_OVERRIDE:
    df_raw = spark.table(DATA_SOURCE_OVERRIDE)
elif DATA_SOURCE == "csv":
    df_raw = (
        spark.read.option("header", True).option("inferSchema", True)
        .option("multiLine", True).option("escape", '"').csv(CSV_PATH)
    )
else:
    df_raw = spark.table(RAW_TABLE)

# Compute kids flag from API fields
df_kids_labels = (
    df_raw
    .select(COL_CHANNEL_ID, COL_MADE_FOR_KIDS, COL_SELF_DECL_KIDS)
    .withColumn(
        "is_kids",
        (lower(coalesce(col(COL_MADE_FOR_KIDS), lit("false"))) == "true")
        | (lower(coalesce(col(COL_SELF_DECL_KIDS), lit("false"))) == "true")
    )
)

# Optionally add seed list
if USE_KIDS_SEED:
    try:
        df_seed = spark.table(KIDS_SEED_TABLE).select(
            col(KIDS_SEED_ID_COL).alias("_kid_id")
        ).distinct()
        df_kids_labels = (
            df_kids_labels
            .join(df_seed, col(COL_CHANNEL_ID) == col("_kid_id"), "left")
            .withColumn("is_kids", col("is_kids") | col("_kid_id").isNotNull())
            .drop("_kid_id")
        )
        print("Kids seed list applied")
    except Exception:
        print("Kids seed table not found — using API flags only")

# Enhanced signal from video-level enrichment (if available)
if "pct_made_for_kids" in df_raw.columns:
    df_kids_labels = df_kids_labels.withColumn(
        "is_kids",
        col("is_kids") | (coalesce(col("pct_made_for_kids"), lit(0.0)) >= 0.5)
    )

kids_pos = df_kids_labels.filter(col("is_kids")).count()
total = df_kids_labels.count()
print(f"Total channels: {total:,}")
print(f"Kids labeled:   {kids_pos:,} ({kids_pos/total*100:.1f}%)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Join with Embeddings & Balance Training Set

# COMMAND ----------

df_embeddings = spark.table(EMBEDDINGS_TABLE)
df = df_embeddings.join(df_kids_labels.select(COL_CHANNEL_ID, "is_kids"), on="channel_id", how="inner")

df_pos = df.filter(col("is_kids") == True)
df_neg = df.filter(col("is_kids") == False)

pos_count = df_pos.count()
neg_count = df_neg.count()

# Downsample negatives to 2x positive count
neg_ratio = min(1.0, (pos_count * 2) / neg_count) if neg_count > 0 else 1.0
df_neg_sample = df_neg.sample(fraction=neg_ratio, seed=RANDOM_STATE)

# Collect downsampled training set to driver (~210K rows max)
df_train = df_pos.unionByName(df_neg_sample).select("channel_id", "embedding", "is_kids").toPandas()

X = np.array(df_train["embedding"].tolist())
y = df_train["is_kids"].astype(int).values

print(f"Training data: {len(X):,} ({y.sum():,} positive, {len(y) - y.sum():,} negative)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Train & Evaluate

# COMMAND ----------

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y,
)

with mlflow.start_run(run_name="kids_logreg") as run:
    clf = LogisticRegression(max_iter=1000, class_weight="balanced", random_state=RANDOM_STATE)
    clf.fit(X_train, y_train)

    y_prob = clf.predict_proba(X_test)[:, 1]
    y_pred = clf.predict(X_test)
    auc = roc_auc_score(y_test, y_prob)
    report = classification_report(y_test, y_pred, output_dict=True)

    mlflow.log_params({
        "model": "LogisticRegression",
        "train_size": len(X_train),
        "test_size": len(X_test),
    })
    mlflow.log_metrics({
        "auc_roc": auc,
        "precision_kids": report["1"]["precision"],
        "recall_kids": report["1"]["recall"],
        "f1_kids": report["1"]["f1-score"],
    })
    mlflow.sklearn.log_model(clf, "kids_classifier")

    print(f"AUC-ROC: {auc:.4f}")
    print(classification_report(y_test, y_pred, target_names=["Not Kids", "Kids"]))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Score Full Dataset (Distributed)
# MAGIC
# MAGIC Uses `pandas_udf` to score across Spark workers — the trained model (~few MB)
# MAGIC is broadcast once, and each partition scores independently.

# COMMAND ----------

bc_model = spark.sparkContext.broadcast(pickle.dumps(clf))

@pandas_udf(FloatType())
def score_kids_udf(embeddings: pd.Series) -> pd.Series:
    """Score embeddings in parallel across Spark partitions."""
    model = pickle.loads(bc_model.value)
    X = np.array(embeddings.tolist())
    if len(X) == 0:
        return pd.Series(dtype=float)
    return pd.Series(model.predict_proba(X)[:, 1])

df_kids_scores = (
    spark.table(EMBEDDINGS_TABLE)
    .select("channel_id", "embedding")
    .withColumn("probability_kids", score_kids_udf(col("embedding")))
    .withColumn(
        "predicted_kids",
        when(col("probability_kids") >= KIDS_CONFIDENCE_THRESHOLD, 1).otherwise(0)
    )
    .select("channel_id", "probability_kids", "predicted_kids")
)

predicted_kids = df_kids_scores.filter(col("predicted_kids") == 1).count()
print(f"Predicted Kids (threshold={KIDS_CONFIDENCE_THRESHOLD}): {predicted_kids:,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Save Results

# COMMAND ----------

df_kids_scores.write.format("delta").mode("overwrite").saveAsTable(KIDS_SCORES_TABLE)
print(f"Kids scores saved to {KIDS_SCORES_TABLE}")
print(f"  Total scored:    {df_kids_scores.count():,}")
print(f"  Predicted Kids:  {predicted_kids:,}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Usage
# MAGIC
# MAGIC Join with the main classification output to add kids signal:
# MAGIC ```sql
# MAGIC SELECT o.*, k.probability_kids, k.predicted_kids
# MAGIC FROM channels_output o
# MAGIC LEFT JOIN kids_scores k ON o.channel_id = k.channel_id
# MAGIC ```
