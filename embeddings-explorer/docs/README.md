# Embeddings Explorer — Documentation

Focused deep-dives on specific parts of the app. For the full picture start with:

- [**README.md**](../README.md) — user-facing setup, deployment, troubleshooting
- [**TECHNICAL_GUIDE.md**](../TECHNICAL_GUIDE.md) — comprehensive technical reference
- [**ARCHITECTURE.md**](../ARCHITECTURE.md) — compact structural overview

## Focused pages

| Page | What it covers |
|---|---|
| [3d-visualization.md](3d-visualization.md) | React-Three-Fiber, instancedMesh performance pattern, t-SNE vs UMAP, LOD labels, cluster hulls |
| [api-reference.md](api-reference.md) | Every route — path, method, request body, SQL behind it, response shape, gotchas |
| [auth.md](auth.md) | Databricks Apps OAuth runtime, local PAT fallback, token caching, switching to per-user auth |

## Related docs (companion DAB pipeline)

The app reads tables produced by [`../../youtube-channel-classification/`](../../youtube-channel-classification/). Its docs are also worth reading:

- [Cosine Similarity](../../youtube-channel-classification/docs/cosine-similarity.md) — the math behind Load 0 classification
- [Embeddings](../../youtube-channel-classification/docs/embeddings.md) — how text becomes a 1024-dim vector
- [IAB Taxonomy](../../youtube-channel-classification/docs/iab-taxonomy.md) — what we're classifying into
- [Architecture](../../youtube-channel-classification/docs/architecture.md) — pipeline flowcharts
