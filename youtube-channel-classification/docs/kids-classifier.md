# Kids Classifier

## Overview

The Kids classifier is an **independent process** that identifies children's content channels. It runs separately from the main IAB classification pipeline and produces a supplementary brand safety signal.

**Output:** `kids_scores` table with `probability_kids` (0.0-1.0) and `predicted_kids` (0/1).

## Why It's Separate

| Reason | Detail |
|--------|--------|
| **Different purpose** | IAB assigns topic categories; Kids detection is a brand safety signal |
| **Different data needs** | Kids classifier needs labeled data (API flags); IAB classification is unsupervised |
| **Different update cadence** | Kids labels may change as YouTube updates flags; IAB categories are stable |
| **Composable** | Join `kids_scores` with any output table as needed |

## How It Works

### Step 1: Build Training Labels

A channel is labeled "Kids" if **any** of these are true:

- YouTube API `madeForKids` flag is `"true"`
- YouTube API `selfDeclaredMadeForKids` flag is `"true"`
- Present in optional seed list (if `USE_KIDS_SEED = True`)
- If video-level enrichment is available: `pct_made_for_kids >= 0.5`

### Step 2: Balance the Training Set

Kids channels are a small minority (~5-10% of total). Without balancing, the model would learn to always predict "not kids" and still get 90%+ accuracy.

**Solution:** Downsample negatives to a 2:1 ratio (2 non-kids for every 1 kids channel). This forces the model to actually learn the kids/non-kids boundary.

### Step 3: Train Logistic Regression

The model is trained on pre-computed [embedding](embeddings.md) vectors (1024-dim). The embedding model already captures semantics — kids channels form a distinct cluster in embedding space. Logistic Regression draws a hyperplane to separate them.

| Model | Accuracy | Training Time | Worth Upgrading? |
|-------|---------|---------------|------------------|
| **Logistic Regression** | High | Seconds | Baseline |
| XGBoost | Slightly higher | Minutes | Marginal gain |
| Neural Network | Marginally higher | Hours | Not worth it |

Training happens on the driver node with sklearn (~210K rows max after downsampling). This is fast and doesn't need distributed compute.

### Step 4: Score All Channels (Distributed)

The trained model (~few MB) is **broadcast** to all Spark workers via `pandas_udf`. Each partition scores its channels independently — the full dataset is never collected to the driver.

```python
# Pseudocode
bc_model = spark.sparkContext.broadcast(pickle.dumps(clf))

@pandas_udf(FloatType())
def score_kids_udf(embeddings):
    model = pickle.loads(bc_model.value)
    return model.predict_proba(embeddings)[:, 1]
```

### Step 5: Save Results

Output table `kids_scores`:
| Column | Type | Description |
|--------|------|-------------|
| `channel_id` | string | YouTube channel ID |
| `probability_kids` | float | Probability of being kids content (0.0-1.0) |
| `predicted_kids` | int | 1 if probability >= threshold (default 0.5), else 0 |

## Usage

Join with the main classification output:

```sql
SELECT o.*, k.probability_kids, k.predicted_kids
FROM channels_output o
LEFT JOIN kids_scores k ON o.channel_id = k.channel_id
WHERE k.predicted_kids = 1
```

## MLflow Tracking

The Kids classifier logs metrics to MLflow:
- `auc_roc` — Area under ROC curve
- `precision_kids` — Precision for kids class
- `recall_kids` — Recall for kids class
- `f1_kids` — F1 score for kids class

The trained model is also logged to MLflow for reproducibility.

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `KIDS_CONFIDENCE_THRESHOLD` | 0.5 | Probability threshold for `predicted_kids` |
| `USE_KIDS_SEED` | False | Whether to use a seed list of known kids channels |
| `KIDS_SEED_TABLE` | `{catalog}.{schema}.kids_seed_channels` | Seed table location |
| `TEST_SIZE` | 0.2 | Train/test split ratio |

## DAB Job

```bash
databricks bundle run kids-classifier -t dev
```

This is a single-task job that can run independently after the classification pipeline has produced channel embeddings.
