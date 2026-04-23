# Documentation

Technical documentation for the YouTube Channel Classification pipeline. These pages explain the ML concepts, architecture, and design decisions in detail — aimed at readers who may not be familiar with machine learning.

## Concepts

- [Embeddings](embeddings.md) — How text is converted to numbers that capture meaning
- [Cosine Similarity](cosine-similarity.md) — How we measure similarity between channels and categories
- [IAB Content Taxonomy](iab-taxonomy.md) — The industry-standard category system we classify into
- [Multi-Label Classification](multi-label-classification.md) — How channels get assigned multiple categories

## Pipeline Components

- [Architecture](architecture.md) — Full pipeline architecture, data flow, and DAB job structure
- [Enrichment](enrichment.md) — Optional video-level metadata enrichment via YouTube API
- [Kids Classifier](kids-classifier.md) — Independent kids content detection for brand safety

## Quick Links

- [README](../README.md) — Project overview, quick start, configuration
- [TECHNICAL_GUIDE](../TECHNICAL_GUIDE.md) — Comprehensive single-page technical reference
- [config.py](../src/config.py) — All configuration parameters
