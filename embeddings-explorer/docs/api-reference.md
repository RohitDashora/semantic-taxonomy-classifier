# API Reference

Full reference for every `/api/*` route. All routes return JSON; all errors come back as `{"error": "<message>"}` with a 4xx/5xx status. All SQL reads use the SQL Warehouse bound to the `sql-warehouse` app resource; embedding calls hit the serving endpoint bound to `serving-endpoint`.

Base URL in production: `https://<app-name>-<workspace-id>.aws.databricksapps.com`. All routes require a Databricks session cookie or a `Bearer` token (from the CLI: `databricks auth token -p <profile>`).

---

## Route map

| Method | Path | Purpose | Cached? | SQL? | FMAPI? |
|---|---|---|---|---|---|
| GET | `/api/health` | Liveness | — | — | — |
| GET | `/api/iab-data` | 698 IAB categories with embeddings + coords | ✓ | ✓ | — |
| GET | `/api/channels/sample` | 5K pre-classified channels (no embeddings) | ✓ | ✓ | — |
| GET | `/api/channels/search?q=...` | Autocomplete channel search | — | ✓ | — |
| GET | `/api/channels/:id` | Single channel detail with embedding | — | ✓ | — |
| POST | `/api/embed` | Embed arbitrary text via FMAPI | — | — | ✓ |
| POST | `/api/knn/channels` | Server-side KNN against channels_embeddings | — | ✓ | — |
| GET | `/api/dendrogram` | Pre-computed Ward linkage for dendrogram | ✓ | ✓ | — |

> ⚠️ **Route ordering matters:** `/api/channels/sample` MUST come **before** `/api/channels/:id` in `server.js`. Express matches in declaration order — if `/:id` wins, `sample` gets captured as the ID parameter and returns 404.

---

## GET `/api/health`

Sanity check. Doesn't hit the warehouse or endpoint.

**Response 200:**
```json
{
  "status": "healthy",
  "catalog": "main",
  "schema": "youtube_channels"
}
```

If this returns but any data route fails, you have a SQL warehouse / permissions problem.

---

## GET `/api/iab-data`

All 698 IAB categories with their full metadata, embeddings, 3D coords, and cluster assignments. Warmed on startup; subsequent calls are < 20 ms.

**Response 200:**
```json
{
  "count": 698,
  "categories": [
    {
      "id": "150",
      "name": "Attractions",
      "tierPath": "Attractions",
      "tierLevel": 1,
      "tier1Parent": "Attractions",
      "description": "YouTube channels in 'Attractions' focus on...",
      "embedding": [0.0123, -0.0341, ..., 0.0174],
      "tsne": [2.41, -1.82, 0.63],
      "umap": [0.84, 1.21, -0.33],
      "clusterKmeans": 4,
      "clusterHdbscan": 12
    }
  ]
}
```

**SQL behind it:**
```sql
SELECT unique_id, name, tier_path, tier_level, tier_1_parent, description,
       embedding, tsne_x, tsne_y, tsne_z, umap_x, umap_y, umap_z,
       cluster_kmeans, cluster_hdbscan
FROM <catalog>.<schema>.iab_viz_precomputed
```

**Size:** ~5 MB gzipped. Embeddings are the bulk (698 × 1024 × 4 bytes = 2.8 MB raw).

**Error 500** if the table doesn't exist — run the DAB's `precompute-viz` job.

---

## GET `/api/channels/sample`

5,000 pre-classified channels with coords. No embeddings (to keep payload small). Warmed on startup.

**Response 200:**
```json
{
  "count": 5000,
  "channels": [
    {
      "id": "UCbCmjCuTUZos6Inko4u57UQ",
      "title": "CoComelon - Nursery Rhymes",
      "primaryCategory": "Family and Parenting",
      "confidence": 0.81,
      "tsne": [-1.23, 4.56, 2.11],
      "umap": [0.45, 0.89, -0.12]
    }
  ]
}
```

**SQL:**
```sql
SELECT channel_id, channel_title, primary_category, primary_confidence,
       tsne_x, tsne_y, tsne_z, umap_x, umap_y, umap_z
FROM <catalog>.<schema>.channels_viz_sample
```

---

## GET `/api/channels/search?q=<text>&limit=<n>`

Autocomplete for channel titles. Case-insensitive `LIKE` match. Returns up to `limit` results (default 20, max 50).

**Request:**
```
GET /api/channels/search?q=marques&limit=5
```

**Response 200:**
```json
{
  "channels": [
    {
      "id": "UCBJycsmduvYEL83R_U4JriQ",
      "title": "Marques Brownlee",
      "primaryCategory": "Technology & Computing",
      "confidence": 0.78
    }
  ]
}
```

**Input sanitization:** `q` is passed through `q.replace(/[^a-zA-Z0-9 \-_.]/g, '').slice(0, 100)` before interpolation. This is the security boundary — the Databricks Statement Execution API does not expose query parameters, so the regex is the defense against SQL injection. Don't remove it.

**SQL:**
```sql
SELECT channel_id, channel_title, primary_category, primary_confidence
FROM <catalog>.<schema>.channels_output
WHERE LOWER(channel_title) LIKE LOWER('%<safe_q>%')
ORDER BY primary_confidence DESC
LIMIT <limit>
```

**Known limitation:** `%` and `_` are wildcards in SQL `LIKE`. The sanitizer strips them, so users can't use them. If you want LIKE wildcards, explicitly escape them instead (`q.replace(/[%_\\]/g, '\\$&')`).

---

## GET `/api/channels/:id`

Single channel detail. Returns the embedding (1024 floats) so the frontend can run KNN or compare with other channels.

**Request:**
```
GET /api/channels/UCBJycsmduvYEL83R_U4JriQ
```

**Response 200:**
```json
{
  "id": "UCBJycsmduvYEL83R_U4JriQ",
  "title": "Marques Brownlee",
  "url": "https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ",
  "primaryCategory": "Technology & Computing",
  "primaryTierPath": "Technology & Computing > Consumer Electronics",
  "confidence": 0.78,
  "numCategories": 5,
  "textInput": "marques brownlee tech reviews smartphones...",
  "embedding": [0.0123, ..., 0.0174]
}
```

**Response 404:**
```json
{"error": "Channel not found"}
```

**Input sanitization:** `req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 30)` — YouTube channel IDs are `UC` + 22 alphanumeric chars.

**SQL:** three parallel queries via `Promise.all`:
```sql
-- 1. Output metadata
SELECT channel_id, channel_title, channel_url, primary_category,
       primary_tier_path, primary_confidence, num_categories
FROM <catalog>.<schema>.channels_output
WHERE channel_id = '<id>' LIMIT 1;

-- 2. Text input
SELECT text_input FROM <catalog>.<schema>.channels_prepped
WHERE channel_id = '<id>' LIMIT 1;

-- 3. Embedding
SELECT embedding FROM <catalog>.<schema>.channels_embeddings
WHERE channel_id = '<id>' LIMIT 1;
```

---

## POST `/api/embed`

Embed arbitrary text via Foundation Model API. Used by the Load 0 tab for live classification.

**Request:**
```json
{"text": "basketball highlights NBA game analysis"}
```

**Response 200:**
```json
{
  "embedding": [0.0123, ..., 0.0174],
  "dimension": 1024,
  "latencyMs": 187
}
```

**Response 400** if text is empty: `{"error": "Text required"}`.

**Behavior:**
- Text is trimmed and clipped to 2,000 characters
- Model: `databricks-gte-large-en` (hardcoded in `lib/embedding-client.js`)
- Latency: 100-400 ms depending on endpoint warmth
- Errors pass through as 500 with upstream error text

**Request to FMAPI:**
```
POST <host>/serving-endpoints/databricks-gte-large-en/invocations
Authorization: Bearer <token>
Content-Type: application/json

{"input": ["basketball highlights NBA game analysis"]}
```

Response: `{data: [{embedding: [...]}]}` — server extracts `data[0].embedding`.

---

## POST `/api/knn/channels`

K nearest neighbors against the full `channels_embeddings` table using SQL cosine similarity. Used by Load 1 tab to blend Load 0 with neighbor votes.

**Request:**
```json
{
  "embedding": [0.0123, ..., 0.0174],
  "k": 10
}
```

**Response 200:**
```json
{
  "neighbors": [
    {
      "id": "UC...",
      "title": "...",
      "primaryCategory": "...",
      "textInput": "...",
      "tsne": [...],
      "umap": [...],
      "similarity": 0.82
    }
  ]
}
```

**Validation:**
- `embedding` must be an array (no dimension check — relies on SQL to fail fast on mismatch)
- `k` is clamped to [1, 50]

**SQL — cosine in-engine:**
```sql
WITH query AS (
  SELECT ARRAY(<floats,...>) AS qemb
),
scored AS (
  SELECT
    c.channel_id, c.channel_title, c.primary_category,
    c.text_input, c.tsne_x, c.tsne_y, c.tsne_z,
    c.umap_x, c.umap_y, c.umap_z,
    AGGREGATE(
      TRANSFORM(
        SEQUENCE(0, SIZE(q.qemb) - 1),
        i -> CAST(q.qemb[i] AS DOUBLE) * c.embedding[i]
      ),
      0D, (acc, x) -> acc + x
    ) / (
      SQRT(AGGREGATE(TRANSFORM(q.qemb, x -> x*x), 0D, (a,x) -> a+x)) *
      SQRT(AGGREGATE(TRANSFORM(c.embedding, x -> x*x), 0D, (a,x) -> a+x))
    ) AS similarity
  FROM <catalog>.<schema>.channels_embeddings c
  CROSS JOIN query q
  WHERE c.embedding IS NOT NULL
)
SELECT * FROM scored ORDER BY similarity DESC LIMIT <k>
```

Why SQL and not Node? Pulling 1.5M × 1024 floats = ~6 GB per query. Scoring in-engine avoids the transfer; only the top-K rows return.

**Latency:** 2-5 seconds on a 1.5M channels table with a Small warehouse. For sub-second, swap for Databricks Vector Search (see [TECHNICAL_GUIDE.md §11](../TECHNICAL_GUIDE.md#11-customization-guide)).

**Security note:** the embedding array is passed via string concatenation into the SQL (values go through `Number(v)` first, so non-numeric input is sanitized). Safe because `Number` rejects anything that isn't numeric. Do **not** weaken this to arbitrary-string concatenation.

---

## GET `/api/dendrogram`

Pre-computed Ward linkage for the IAB taxonomy dendrogram. Returned as the raw serialized scipy matrix (the frontend reconstructs the tree via D3).

**Response 200:**
```json
{
  "linkage": [
    [0, 1, 0.12, 2],
    [2, 3, 0.18, 2],
    // ... Ward linkage rows
  ]
}
```

**Response 200 with null** (if the table row is missing):
```json
{"linkage": null}
```

**SQL:**
```sql
SELECT linkage_json FROM <catalog>.<schema>.viz_dendrogram_linkage LIMIT 1
```

Cached on first call.

---

## Error response format

All error responses use the same shape:

```json
{"error": "Human-readable message"}
```

Common errors:

| Status | When |
|---|---|
| 400 | Bad request (missing body, invalid params) |
| 404 | Channel not found |
| 500 | SQL query failed, FMAPI call failed, or upstream error |
| 401 | Missing/invalid Databricks session or bearer token |
| 403 | App SP missing grants (UC SELECT, warehouse `Can use`, endpoint `Can query`) |

For the latter two, see [auth.md](auth.md) and the README's troubleshooting table.

---

## Extending the API

To add a new route:

1. Put specific paths (`/api/foo/bar`) **before** parameterized paths (`/api/foo/:id`)
2. Use `try/catch` with structured error returns — don't throw
3. Sanitize user input before interpolating into SQL
4. Respect existing caching conventions (cache stable, whole-table reads; don't cache user-specific queries)
5. Document it here

Boilerplate:
```js
app.get('/api/foo', async (req, res) => {
  try {
    const rows = await executeSQL(`SELECT ... FROM ${CATALOG}.${SCHEMA}...`);
    res.json({ results: rows.map(r => ({ ... })) });
  } catch (err) {
    console.error('Foo error:', err);
    res.status(500).json({ error: 'Failed to load foo' });
  }
});
```
