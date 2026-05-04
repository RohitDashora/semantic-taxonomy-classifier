import express from 'express';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeSQL } from './lib/databricks-sql.js';
import { embedText } from './lib/embedding-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8000;

// Config
const CATALOG = process.env.CATALOG || 'main';
const SCHEMA = process.env.SCHEMA || 'youtube_channels';

// Pipeline table names — overridable via env to retarget the app at a different
// taxonomy/dataset without code changes.
const T_IAB_VIZ = process.env.TABLE_IAB_VIZ || 'iab_viz_precomputed';
const T_DENDROGRAM = process.env.TABLE_DENDROGRAM || 'viz_dendrogram_linkage';
const T_CHANNELS_OUTPUT = process.env.TABLE_CHANNELS_OUTPUT || 'channels_output';
const T_CHANNELS_PREPPED = process.env.TABLE_CHANNELS_PREPPED || 'channels_prepped';
const T_CHANNELS_EMBEDDINGS = process.env.TABLE_CHANNELS_EMBEDDINGS || 'channels_embeddings';
const T_CHANNELS_VIZ = process.env.TABLE_CHANNELS_VIZ || 'channels_viz_sample';

app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// ─── In-memory caches ───────────────────────────────────────────────────────

let iabCache = null;
let channelSampleCache = null;
let dendrogramCache = null;

// ─── Health ─────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', catalog: CATALOG, schema: SCHEMA });
});

// ─── IAB Data (698 categories + embeddings + 3D coords + clusters) ──────────

app.get('/api/iab-data', async (req, res) => {
  try {
    if (iabCache) return res.json(iabCache);

    const rows = await executeSQL(`
      SELECT unique_id, name, tier_path, tier_level, tier_1_parent, description,
             embedding, tsne_x, tsne_y, tsne_z, umap_x, umap_y, umap_z,
             cluster_kmeans, cluster_hdbscan
      FROM ${CATALOG}.${SCHEMA}.${T_IAB_VIZ}
    `);

    const categories = rows.map(r => ({
      id: r.unique_id,
      name: r.name,
      tierPath: r.tier_path,
      tierLevel: parseInt(r.tier_level) || 0,
      tier1Parent: r.tier_1_parent,
      description: r.description,
      embedding: r.embedding ? JSON.parse(r.embedding) : null,
      tsne: [parseFloat(r.tsne_x) || 0, parseFloat(r.tsne_y) || 0, parseFloat(r.tsne_z) || 0],
      umap: [parseFloat(r.umap_x) || 0, parseFloat(r.umap_y) || 0, parseFloat(r.umap_z) || 0],
      clusterKmeans: parseInt(r.cluster_kmeans) || 0,
      clusterHdbscan: parseInt(r.cluster_hdbscan) || -1,
    }));

    iabCache = { categories, count: categories.length };
    res.json(iabCache);
  } catch (err) {
    console.error('IAB data error:', err);
    res.status(500).json({ error: 'Failed to load IAB taxonomy data' });
  }
});

// ─── Dendrogram Linkage ─────────────────────────────────────────────────────

app.get('/api/dendrogram', async (req, res) => {
  try {
    if (dendrogramCache) return res.json(dendrogramCache);

    const rows = await executeSQL(`
      SELECT linkage_json FROM ${CATALOG}.${SCHEMA}.${T_DENDROGRAM} LIMIT 1
    `);

    if (!rows.length || !rows[0].linkage_json) {
      return res.json({ linkage: null });
    }
    dendrogramCache = { linkage: JSON.parse(rows[0].linkage_json) };
    res.json(dendrogramCache);
  } catch (err) {
    console.error('Dendrogram error:', err);
    res.status(500).json({ error: 'Failed to load dendrogram data' });
  }
});

// ─── Channel Search (autocomplete) ─────────────────────────────────────────

app.get('/api/channels/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    if (!q || q.length < 2) return res.json({ channels: [] });

    // Sanitize: strip anything that isn't alphanumeric, space, or basic punctuation
    const safeQ = q.replace(/[^a-zA-Z0-9 \-_.]/g, '').slice(0, 100);
    if (!safeQ) return res.json({ channels: [] });

    const rows = await executeSQL(`
      SELECT channel_id, channel_title, primary_category, primary_confidence
      FROM ${CATALOG}.${SCHEMA}.${T_CHANNELS_OUTPUT}
      WHERE LOWER(channel_title) LIKE LOWER('%${safeQ}%')
      ORDER BY primary_confidence DESC
      LIMIT ${limit}
    `);

    res.json({
      channels: rows.map(r => ({
        id: r.channel_id,
        title: r.channel_title,
        primaryCategory: r.primary_category,
        confidence: parseFloat(r.primary_confidence) || 0,
      })),
    });
  } catch (err) {
    console.error('Channel search error:', err);
    res.status(500).json({ error: 'Channel search failed' });
  }
});

// ─── Channel Sample (5000 pre-computed points, no embeddings) ──────────────
// NOTE: This route MUST be defined before /api/channels/:id so Express
// doesn't treat "sample" as a channel ID parameter.

app.get('/api/channels/sample', async (req, res) => {
  try {
    if (channelSampleCache) return res.json(channelSampleCache);

    const rows = await executeSQL(`
      SELECT channel_id, channel_title, primary_category, primary_confidence,
             tsne_x, tsne_y, tsne_z, umap_x, umap_y, umap_z
      FROM ${CATALOG}.${SCHEMA}.${T_CHANNELS_VIZ}
    `);

    const channels = rows.map(r => ({
      id: r.channel_id,
      title: r.channel_title,
      primaryCategory: r.primary_category,
      confidence: parseFloat(r.primary_confidence) || 0,
      tsne: [parseFloat(r.tsne_x) || 0, parseFloat(r.tsne_y) || 0, parseFloat(r.tsne_z) || 0],
      umap: [parseFloat(r.umap_x) || 0, parseFloat(r.umap_y) || 0, parseFloat(r.umap_z) || 0],
    }));

    channelSampleCache = { channels, count: channels.length };
    res.json(channelSampleCache);
  } catch (err) {
    console.error('Channel sample error:', err);
    res.status(500).json({ error: 'Failed to load channel sample data' });
  }
});

// ─── Channel Detail ─────────────────────────────────────────────────────────

app.get('/api/channels/:id', async (req, res) => {
  try {
    // Channel IDs are alphanumeric (YouTube format: UC + 22 chars)
    const channelId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 30);

    const [outputRows, prepRows, embRows] = await Promise.all([
      executeSQL(`
        SELECT channel_id, channel_title, channel_url, primary_category,
               primary_tier_path, primary_confidence, num_categories
        FROM ${CATALOG}.${SCHEMA}.${T_CHANNELS_OUTPUT}
        WHERE channel_id = '${channelId}' LIMIT 1
      `),
      executeSQL(`
        SELECT text_input FROM ${CATALOG}.${SCHEMA}.${T_CHANNELS_PREPPED}
        WHERE channel_id = '${channelId}' LIMIT 1
      `),
      executeSQL(`
        SELECT embedding FROM ${CATALOG}.${SCHEMA}.${T_CHANNELS_EMBEDDINGS}
        WHERE channel_id = '${channelId}' LIMIT 1
      `),
    ]);

    if (!outputRows.length) return res.status(404).json({ error: 'Channel not found' });

    const channel = {
      id: outputRows[0].channel_id,
      title: outputRows[0].channel_title,
      url: outputRows[0].channel_url,
      primaryCategory: outputRows[0].primary_category,
      primaryTierPath: outputRows[0].primary_tier_path,
      confidence: parseFloat(outputRows[0].primary_confidence) || 0,
      numCategories: parseInt(outputRows[0].num_categories) || 0,
      textInput: prepRows[0]?.text_input || '',
      embedding: embRows[0] ? JSON.parse(embRows[0].embedding) : null,
    };

    res.json(channel);
  } catch (err) {
    console.error('Channel detail error:', err);
    res.status(500).json({ error: 'Failed to load channel details' });
  }
});

// ─── Embed Text (live) ─────────────────────────────────────────────────────

app.post('/api/embed', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Text required' });

    const start = Date.now();
    const embedding = await embedText(text.trim().slice(0, 2000));
    const latency = Date.now() - start;

    res.json({ embedding, dimension: embedding.length, latencyMs: latency });
  } catch (err) {
    console.error('Embed error:', err);
    res.status(500).json({ error: 'Embedding generation failed' });
  }
});

// ─── KNN Channels (SQL-based cosine similarity) ───────────────────────────

app.post('/api/knn/channels', async (req, res) => {
  try {
    const { embedding, k = 10 } = req.body;
    if (!embedding || !Array.isArray(embedding)) {
      return res.status(400).json({ error: 'Embedding array required' });
    }

    const safeK = Math.max(1, Math.min(parseInt(k) || 10, 50));

    // Build the query embedding as a SQL ARRAY literal
    const embeddingLiteral = `ARRAY(${embedding.map(v => Number(v)).join(',')})`;

    // Compute cosine similarity in SQL:
    //   dot(a,b) / (norm(a) * norm(b))
    // Using aggregate_zip + aggregate to compute dot product and norms
    const rows = await executeSQL(`
      WITH query AS (
        SELECT ${embeddingLiteral} AS qemb
      ),
      scored AS (
        SELECT
          c.channel_id,
          c.channel_title,
          c.primary_category,
          c.text_input,
          c.tsne_x, c.tsne_y, c.tsne_z,
          c.umap_x, c.umap_y, c.umap_z,
          AGGREGATE(
            TRANSFORM(
              SEQUENCE(0, SIZE(q.qemb) - 1),
              i -> CAST(q.qemb[i] AS DOUBLE) * c.embedding[i]
            ),
            CAST(0 AS DOUBLE),
            (acc, x) -> acc + x
          ) / (
            SQRT(AGGREGATE(TRANSFORM(q.qemb, v -> CAST(v AS DOUBLE) * CAST(v AS DOUBLE)), CAST(0 AS DOUBLE), (acc, x) -> acc + x)) *
            SQRT(AGGREGATE(TRANSFORM(c.embedding, v -> v * v), CAST(0 AS DOUBLE), (acc, x) -> acc + x))
          ) AS similarity
        FROM ${CATALOG}.${SCHEMA}.${T_CHANNELS_VIZ} c
        CROSS JOIN query q
      )
      SELECT channel_id, channel_title, primary_category, text_input,
             similarity, tsne_x, tsne_y, tsne_z, umap_x, umap_y, umap_z
      FROM scored
      ORDER BY similarity DESC
      LIMIT ${safeK}
    `);

    const neighbors = rows.map(r => ({
      id: r.channel_id,
      title: r.channel_title,
      primaryCategory: r.primary_category,
      textInput: r.text_input,
      similarity: parseFloat(r.similarity) || 0,
      tsne: [parseFloat(r.tsne_x) || 0, parseFloat(r.tsne_y) || 0, parseFloat(r.tsne_z) || 0],
      umap: [parseFloat(r.umap_x) || 0, parseFloat(r.umap_y) || 0, parseFloat(r.umap_z) || 0],
    }));

    res.json({ neighbors });
  } catch (err) {
    console.error('KNN error:', err);
    res.status(500).json({ error: 'KNN search failed' });
  }
});

// ─── SPA Fallback ───────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────────────────────

// ─── Cache Warming ─────────────────────────────────────────────────────────

async function warmCaches() {
  try {
    console.log('Warming IAB cache...');
    const rows = await executeSQL(`
      SELECT unique_id, name, tier_path, tier_level, tier_1_parent, description,
             embedding, tsne_x, tsne_y, tsne_z, umap_x, umap_y, umap_z,
             cluster_kmeans, cluster_hdbscan
      FROM ${CATALOG}.${SCHEMA}.${T_IAB_VIZ}
    `);
    const categories = rows.map(r => ({
      id: r.unique_id,
      name: r.name,
      tierPath: r.tier_path,
      tierLevel: parseInt(r.tier_level) || 0,
      tier1Parent: r.tier_1_parent,
      description: r.description,
      embedding: r.embedding ? JSON.parse(r.embedding) : null,
      tsne: [parseFloat(r.tsne_x) || 0, parseFloat(r.tsne_y) || 0, parseFloat(r.tsne_z) || 0],
      umap: [parseFloat(r.umap_x) || 0, parseFloat(r.umap_y) || 0, parseFloat(r.umap_z) || 0],
      clusterKmeans: parseInt(r.cluster_kmeans) || 0,
      clusterHdbscan: parseInt(r.cluster_hdbscan) || -1,
    }));
    iabCache = { categories, count: categories.length };
    console.log(`  IAB cache warmed: ${categories.length} categories`);
  } catch (err) {
    console.warn('Cache warming failed (will retry on first request):', err.message);
  }
}

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const authMode = process.env.DATABRICKS_TOKEN ? 'token' :
    (process.env.DATABRICKS_CLIENT_ID ? 'oauth (service principal)' : 'none');
  console.log(`Embeddings Explorer running on port ${PORT}`);
  console.log(`  Catalog:   ${CATALOG}.${SCHEMA}`);
  console.log(`  Warehouse: ${process.env.DATABRICKS_WAREHOUSE_ID || 'not set'}`);
  console.log(`  Endpoint:  ${process.env.EMBEDDING_ENDPOINT_NAME || '(not set, using default)'}`);
  console.log(`  Host:      ${process.env.DATABRICKS_HOST || 'not set'}`);
  console.log(`  Auth:      ${authMode}`);
  warmCaches();
});
