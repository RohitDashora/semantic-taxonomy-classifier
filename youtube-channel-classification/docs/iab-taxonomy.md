# IAB Content Taxonomy v3.0

## What Is the IAB Content Taxonomy?

The **IAB (Interactive Advertising Bureau) Content Taxonomy v3.0** is the industry standard for categorizing digital content. It's maintained by the IAB Tech Lab and used by ad exchanges, DSPs, SSPs, and brand safety platforms worldwide.

When you classify a YouTube channel as "Sports > Basketball > NBA", downstream advertising systems already understand what that means — no custom taxonomy mapping needed.

## Structure

The taxonomy is hierarchical with ~698 categories across 4 tiers:

| Tier | Count | Example | Use |
|------|-------|---------|-----|
| Tier 1 | ~30 | Sports, Music, Technology & Computing | Broad targeting |
| Tier 2 | ~200 | Sports > Basketball, Technology > Smartphones | Category targeting |
| Tier 3 | ~300 | Sports > Extreme Sports > Skateboarding | Specific targeting |
| Tier 4 | ~20 | Music > Rock Music > Classic Rock | Very specific |

Each category has:
- **Unique ID** — Stable numeric identifier
- **Parent ID** — Links to parent category (tree structure)
- **Name** — Human-readable label
- **Tier path** — Full hierarchy string (e.g., "Sports > Basketball > NBA")
- **Extension** — Flags like SCD (Sensitive Content Designation)

## Sensitive Content Designations (SCD)

Some categories are flagged as **sensitive** for brand safety:

- Alcohol
- Drugs
- Gambling
- Adult Content
- Tobacco
- Weapons
- Sensitive Social Topics

These SCD flags are preserved in the `is_sensitive` column, enabling brand safety filtering:

```sql
SELECT f.channel_id, f.category_name, f.confidence
FROM channels_classification_flat f
JOIN iab_taxonomy t ON f.iab_id = t.unique_id
WHERE t.is_sensitive = true AND f.confidence >= 0.4
```

## Why IAB?

1. **Industry standard** — Downstream ad systems already speak this taxonomy
2. **Comprehensive** — Covers all major content verticals
3. **Hierarchical** — Supports both broad and specific classification
4. **Includes brand safety** — SCD flags for sensitive categories
5. **Freely available** — CC-BY-3.0 license, machine-readable TSV from GitHub
6. **Maintained** — Updated by IAB Tech Lab with industry input

## How We Use It

### Download (one-time)

The `00_download_taxonomy.py` notebook downloads the TSV directly from [GitHub](https://github.com/InteractiveAdvertisingBureau/Taxonomies) and saves it as a Delta table (`iab_taxonomy_raw`). No manual file uploads needed.

### Prepare (one-time)

For each of the 698 categories, `01_prepare_taxonomy.py`:

1. **Generates a rich description** using an LLM — e.g., for "Sports > Basketball > NBA": *"Channels covering the National Basketball Association, including game highlights, player analysis, trade rumors, and fantasy basketball advice."*
2. **Embeds the description** using the same model as channel embeddings (`databricks-gte-large-en`, 1024-dim)

**Why LLM descriptions?** Embedding just the category name "Basketball" gives a weaker vector than embedding a 2-3 sentence description that captures the full semantic scope. This is a one-time cost of ~698 LLM calls (~$1-2).

### Classify

Channel [embeddings](embeddings.md) are compared to category embeddings via [cosine similarity](cosine-similarity.md), producing [multi-label](multi-label-classification.md) category assignments.

## Source

- **Repository:** [InteractiveAdvertisingBureau/Taxonomies](https://github.com/InteractiveAdvertisingBureau/Taxonomies)
- **File:** `Content Taxonomy/Content Taxonomy 3.0.tsv`
- **License:** CC-BY-3.0 (free for commercial use with attribution)

## Known Limitations

1. **English-centric** — Category names and descriptions are in English
2. **YouTube gaps** — Some YouTube-specific categories (e.g., "ASMR", "Speedrunning") may not have direct IAB matches
3. **Static** — The taxonomy is versioned; new content categories may not be covered until IAB updates
