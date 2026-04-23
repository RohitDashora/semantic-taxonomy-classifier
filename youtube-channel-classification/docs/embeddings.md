# Embeddings

## What Are Embeddings?

An embedding converts text into a list of numbers (a **vector**) that captures the text's meaning. The key insight: texts with similar meaning produce similar vectors, even if they use completely different words.

```
"NBA basketball highlights"  → [0.82, -0.15, 0.43, ...]  ─┐ close in
"College basketball scores"  → [0.79, -0.12, 0.41, ...]  ─┘ vector space

"French cooking recipes"     → [-0.31, 0.67, 0.12, ...]  ─┐ close in
"Italian baking tutorials"   → [-0.28, 0.64, 0.15, ...]  ─┘ vector space
```

The embedding model has been trained on billions of text pairs to understand that "recipe" and "cooking tutorial" are related concepts — even though they share no words.

## Analogy: Channels as Cities on a Map

Think of channels as cities on a map. Cooking channels cluster in one region, gaming channels in another, and music channels in a third. The embedding model draws this map from the text — channels with similar meaning end up geographically close, even if they use different words.

This numeric representation is what makes classification possible: we compare each channel's position on this map to the positions of IAB category descriptions.

## How We Use Embeddings

In this pipeline, we embed two things:

1. **Channel text** — Each channel's title + description + keywords + topic categories, concatenated into a single `text_input` string
2. **IAB category descriptions** — Each of the 698 IAB categories gets an LLM-generated description that's then embedded

Both are embedded using the **same model**, so they exist in the same vector space and can be compared via [cosine similarity](cosine-similarity.md).

## Model: `databricks-gte-large-en`

| Property | Value |
|----------|-------|
| **Model** | GTE-Large-EN (General Text Embeddings) |
| **Origin** | Alibaba DAMO Academy, hosted as Databricks Foundation Model |
| **Dimensions** | 1024 |
| **Language** | English-optimized |
| **Access** | Foundation Model API — no GPU cluster needed |

### Why This Model

1. **Zero infrastructure** — Runs as a managed API endpoint on Databricks. No GPU clusters, no model weights, no CUDA drivers.
2. **Quality** — GTE-Large consistently ranks in the top tier on text embedding benchmarks (MTEB).
3. **Dimension balance** — 1024 dims is a sweet spot — enough to capture nuance across hundreds of topics, not so large that compute suffers.
4. **Throughput** — The Foundation Model API handles batching (50 texts per call) with built-in rate limiting.

### Alternative: `BAAI/bge-small-en-v1.5` (Self-Hosted GPU)

| Property | GTE-Large (FMAPI) | BGE-Small (self-hosted) |
|----------|--------------------|------------------------|
| Dimensions | 1024 | 384 |
| Compute | API calls (no GPU) | Requires GPU cluster |
| Cost model | Per-token API pricing | GPU cluster hours |
| Throughput | ~50 texts/batch, rate limited | ~256 texts/batch, GPU-limited |
| Quality | Higher | Slightly lower (but competitive) |
| Best for | < 500K channels or no GPU | > 500K channels with GPU budget |

Switch via `USE_FOUNDATION_MODEL_API = False` in config.

## Embeddings vs. Alternative Approaches

| Approach | How It Works | Pros | Cons |
|----------|-------------|------|------|
| **Semantic Embeddings (ours)** | Neural model converts text to dense vector | Captures synonyms and context; handles messy text | Requires embedding model |
| **TF-IDF** | Counts word frequencies, weights by rarity | Simple, fast, no model needed | Only matches exact words; misses "recipe" = "cooking" |
| **Bag of Words** | Counts word occurrences | Simplest | Loses all semantics; no synonym handling |
| **LLM Zero-Shot** | Send each text to LLM with "classify this" | Handles edge cases well | Extremely slow at 1.5M scale (~$15K+ cost) |

## What Gets Lost

- **Non-English text** — The model is English-optimized. Japanese, Arabic, etc. channels produce lower-quality embeddings.
- **Emojis** — Stripped during text cleaning, but some channels rely on emojis as descriptors.
- **Formatting** — A description with bullet points vs. prose are treated identically.

## Distributed Embedding at Scale

Channel embeddings are computed via `pandas_udf` — Spark distributes the work across workers, each embedding its partition independently.

| Scale | FMAPI (no GPU) | Self-hosted GPU (4x A10G) |
|-------|----------------|---------------------------|
| 10K channels | Minutes | Seconds |
| 100K channels | ~1 hour | Minutes |
| 1.5M channels | 5-25 hours (rate limited) | ~5 minutes compute |

For > 500K channels, the GPU path is typically more cost-effective despite cluster overhead.
