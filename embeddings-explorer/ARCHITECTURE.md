# Architectural Notes — Embeddings Explorer

Compact structural reference for the Embeddings Explorer Databricks App. For deployment and usage see [README.md](README.md); for the comprehensive technical deep-dive see [TECHNICAL_GUIDE.md](TECHNICAL_GUIDE.md).

## What this app does

A Databricks App that classifies YouTube channels into IAB content categories using embeddings, cosine similarity, and KNN refinement. It visualizes 698 IAB categories and 5,000 pre-classified channels in interactive 3D embedding space.

**Classification pipeline:**
- **Load 0 (Semantic):** Embed input text via `databricks-gte-large-en` (1024-dim), cosine-similarity against pre-embedded IAB taxonomy
- **Load 1 (KNN Refinement):** Find K nearest previously-classified channels, blend their category votes with Load 0 scores (`0.75 × L0 + 0.25 × KNN_support`)
- **Confidence Gating:** `gapFromFirst > 0.08` = strong winner (1 label), else multi-label (2-3 labels)

## Architecture

```
React (Vite) + React Three Fiber → Express server → Databricks SQL Warehouse + Model Serving
```

### Server (`server.js`)
- Express backend, serves static frontend from `dist/`
- All API routes under `/api/`
- In-memory caches: `iabCache`, `channelSampleCache` — warmed on startup
- Auth via Databricks App OAuth (lib/auth.js)
- SQL via Databricks Statement Execution API (lib/databricks-sql.js)
- Embedding via Foundation Model API (lib/embedding-client.js)

### Data Tables (Unity Catalog: `main.youtube_channels`)
| Table | Purpose |
|-------|---------|
| `iab_categories_embeddings` | 698 IAB categories with pre-computed embeddings, t-SNE/UMAP coords, cluster assignments |
| `channels_output` | Classified channels — primary category, confidence, tier path |
| `channels_prepped` | Channel text inputs used for embedding |
| `channels_embeddings` | Channel embedding vectors |
| `channels_viz_sample` | 5000 channels with pre-computed t-SNE/UMAP 3D coords for galaxy view |
| `viz_dendrogram_linkage` | Pre-computed Ward linkage matrix for dendrogram |

### API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/iab-data` | GET | All 698 categories with embeddings + coords (cached) |
| `/api/channels/search` | GET | Search channels by title (query param `q`) |
| `/api/channels/sample` | GET | 5000 pre-computed channel points (cached) |
| `/api/channels/:id` | GET | Single channel detail with embedding |
| `/api/embed` | POST | Live embedding via model serving |
| `/api/knn/channels` | POST | Server-side KNN against channel embeddings |
| `/api/dendrogram` | GET | Ward linkage data for dendrogram viz |

**IMPORTANT: Route ordering matters.** `/api/channels/sample` MUST be defined before `/api/channels/:id` in Express, otherwise "sample" gets captured as an `:id` parameter and returns 404.

## Frontend Structure

### Tabs (5 views)
1. **Embedding Space** (`ExplorerView`) — 3D scatter of 698 IAB categories, cluster exploration, category filtering
2. **Load 0: Classify** (`SimilarityView`) — Cosine similarity results, bar charts, histogram, threshold slider
3. **Load 1: KNN Refine** (`KNNView`) — KNN force graphs, neighbor tables, blended score comparison
4. **Taxonomy Analysis** (`ClusteringView`) — Hierarchy alignment, confusion matrix, cluster purity, dendrogram
5. **Channel Galaxy** (`ChannelGalaxyView`) — 5000 channels in 3D, category filtering with edges

### Key Components

**3D (React Three Fiber / drei / postprocessing):**
- `EmbeddingScene` — Main 3D canvas for Embedding Space tab
- `GalaxyScene` — 3D canvas for Channel Galaxy tab
- `CategoryPoints` — instancedMesh rendering IAB categories (spheres)
- `ChannelGalaxy` — instancedMesh rendering 5000 channels
- `CategoryChannelEdges` — Lines from category anchor to filtered channels
- `ConnectionLines` — Lines from user point to assigned categories
- `ClusterHulls` — ConvexGeometry hulls around clusters
- `LODLabels` — Level-of-detail HTML labels in 3D
- `UserPoint` — Animated point showing user's embedding position
- `CameraController` — Smooth camera fly-to animation
- `SceneControls` — Projection toggle, cluster controls overlay

**Charts (D3-based):**
- `KNNForceGraph` — D3 force simulation showing KNN neighbors
- `Dendrogram` — Interactive collapsible D3 dendrogram (Ward linkage)
- `SimilarityBarChart`, `SimilarityHistogram`, `RadarChart` — Score visualizations
- `ConfusionMatrix` — Tier1 × KMeans heatmap grid
- `ClusterPurity` — Stacked horizontal bars showing cluster composition

**Input:**
- `TextInput` — Search bar with demo channel pills and channel picker
- `ChannelPicker` — Autocomplete channel search dropdown

### Hooks
- `useIABData` — Fetches and caches IAB categories
- `useEmbedding` — Calls `/api/embed`, returns embedding + latency
- `useCosineSimilarity` — Client-side cosine scoring, gap-based confidence
- `useChannelSample` — Fetches 5000 channel sample with error/retry
- `useChannelSearch` — Debounced channel search

### Client-side Libraries (`src/lib/`)
- `cosine.js` — Cosine similarity, position interpolation
- `knn.js` — K-nearest-neighbor search
- `colors.js` — Tier 1 color palette (26 colors for IAB Tier 1 groups)

## Performance Patterns

### instancedMesh Optimization
Both `CategoryPoints` and `ChannelGalaxy` use Three.js instancedMesh for rendering hundreds/thousands of spheres efficiently:
- **Reusable temp objects:** `tmpColor = new THREE.Color()` via `useMemo` — never allocate in render loop
- **Dirty-flag pattern:** `initializedRef`, `prevHoveredRef` refs skip `useFrame` updates when nothing changed
- **Reset on data change:** Set `initializedRef.current = false` inside the positions `useMemo` to force re-render

### Caching
- Server warms `iabCache` and `channelSampleCache` on startup to avoid 50s cold-start latency
- Client-side: hooks cache results in React state, no redundant fetches

## Deployment

### Databricks Apps
```
App name:       embeddings-explorer (override via $APP_NAME)
Workspace path: /Workspace/Users/<profile-user-email>/apps/<APP_NAME>
                (derived from the Databricks CLI profile at deploy time)
```

See [`README.md`](README.md) for full setup instructions (prereqs, service principal grants, resource bindings, troubleshooting).

### Deploy Process
Use `./scripts/deploy.sh <profile>` (or `DATABRICKS_PROFILE=<profile> npm run deploy`) which:
1. Builds frontend with Vite → `dist/`
2. Creates clean `deploy/` directory with only runtime files
3. Installs production-only deps (express + compression ≈ 4.4MB)
4. Strips docs/tests/typings from node_modules
5. Uploads to the user's workspace via `databricks workspace import-dir`
6. Deploys via `databricks apps deploy`

**CRITICAL:** Never use `databricks workspace import-dir .` from project root — it uploads 244MB of dev node_modules. Always deploy from `deploy/` directory.

### Manual Deploy Steps (if not using the script)
```bash
PROFILE=<your-profile>
USER_EMAIL=$(databricks current-user me -p "$PROFILE" -o json | jq -r .userName)
WS_PATH="/Workspace/Users/$USER_EMAIL/apps/embeddings-explorer"

npm run build
rm -rf deploy/dist && cp -r dist deploy/dist
cp server.js deploy/server.js
cp -r lib deploy/lib
databricks workspace import-dir deploy/ "$WS_PATH" --overwrite --profile "$PROFILE"
databricks apps deploy embeddings-explorer --source-code-path "$WS_PATH" --profile "$PROFILE"
```

## Common Gotchas

1. **Express route ordering** — Parameterized routes (`:id`) must come AFTER specific routes (`/sample`) or Express captures the literal as a parameter
2. **Null embeddings** — Some rows may have null/missing embeddings; always guard with `r.embedding ? JSON.parse(r.embedding) : null`
3. **parseFloat fallbacks** — Numeric columns from SQL can arrive as strings; always `parseFloat(x) || 0`
4. **instancedMesh key prop** — When `categories.length` changes, the instancedMesh needs a new `key` to recreate the buffer
5. **ConvexGeometry needs 4+ points** — ClusterHulls must guard against clusters with < 4 members
6. **coordKey consistency** — Always derive from `projection` prop: `projection === 'tsne' ? 'tsne' : 'umap'`
7. **Deploy directory hygiene** — Always `rm -rf deploy/dist` before copying new build to avoid stale asset bundles

## Scaling This Pattern

The Load 0 + Load 1 + confidence gating pipeline is taxonomy-agnostic. To apply to a new domain:

| Swap | From | To (example) |
|------|------|--------------|
| Taxonomy table | IAB categories | Product taxonomy, support categories, game genres |
| Reference pool | YouTube channels | Products, tickets, games |
| Input text | Channel description | Product listing, ticket body, game description |
| Thresholds | 0.3 similarity, 0.08 gap | Tune per domain |

At scale (50K+ taxonomy, 1M+ reference items): replace client-side cosine with Databricks Vector Search, move batch classification to Spark UDF, keep this app as the explainability/debugging layer.
