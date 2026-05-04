# Embeddings Explorer

An interactive **Databricks App** for exploring and debugging the YouTube channel → IAB Content Category classification pipeline. Visualizes 698 IAB categories and 5,000 pre-classified channels in 3D embedding space, with live single-channel classification demos.

> ⚠️ **Demo implementation.** This is a reference/demo asset intended for adaptation, not a production-ready product. No SLA, no warranty, no official support. Use it to learn the pattern, then adapt for your own domain, taxonomy, and scale.

---

## Table of contents

1. [What this app does](#what-this-app-does)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Required Unity Catalog tables](#required-unity-catalog-tables)
5. [Service principal permissions](#service-principal-permissions)
6. [Local development setup](#local-development-setup)
7. [Deploy to Databricks Apps](#deploy-to-databricks-apps)
8. [Verify the deployment](#verify-the-deployment)
9. [Troubleshooting](#troubleshooting)
10. [Customization](#customization)

---

## What this app does

Five interactive tabs, all backed by pre-computed embeddings in Unity Catalog:

| Tab | Purpose |
|---|---|
| **Embedding Space** | 3D scatter of 698 IAB categories; explore clusters and hierarchy |
| **Load 0: Classify** | Enter channel text → live cosine similarity against IAB → ranked labels |
| **Load 1: KNN Refine** | Blend Load 0 with K-nearest previously-classified channels |
| **Taxonomy Analysis** | Dendrogram, confusion matrix, cluster purity |
| **Channel Galaxy** | 5,000 pre-classified channels in 3D, with category filtering |

The classification logic (Load 0 → Load 1 → confidence gating) is taxonomy-agnostic — swap the IAB taxonomy for product categories, support tags, game genres, etc.

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌────────────────────────┐
│  React SPA   │────▶│   Express    │────▶│ SQL Warehouse (UC)     │
│ (Three.js,   │     │   (Node.js)  │     │   Foundation Model API │
│  D3, Vite)   │     │              │     │   (gte-large-en)       │
└──────────────┘     └──────────────┘     └────────────────────────┘
       │                    │
       └── served from ─────┘
           dist/ by Express
```

- **Frontend:** React + Vite, React-Three-Fiber for 3D, D3 for charts. Built to `dist/`.
- **Backend:** Single `server.js` (Express) serving `dist/` + `/api/*` routes.
- **Auth:** Databricks Apps platform injects a short-lived OAuth token into `x-forwarded-access-token` (see `lib/auth.js`). No PATs needed in production.
- **Data:** SQL Statement Execution API + Foundation Model API, both hit from the server.

Full architecture reference: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Prerequisites

Before you deploy, make sure you have:

- **Databricks workspace** on AWS or Azure (Unity Catalog enabled)
- **Databricks CLI** ≥ 0.298 — [install](https://docs.databricks.com/en/dev-tools/cli/install.html). Older versions hit a Terraform PGP-key-expired error during `bundle deploy`.
  ```bash
  databricks --version
  ```
- **A configured CLI profile** pointing to your target workspace:
  ```bash
  databricks configure            # creates a profile in ~/.databrickscfg
  databricks auth profiles        # list configured profiles
  ```
- **`jq`** on your shell (used by `deploy.sh` to parse CLI output):
  ```bash
  brew install jq                 # macOS
  apt install jq                  # Debian/Ubuntu
  ```
- **Node.js** ≥ 18
- **A serverless SQL Warehouse** in the workspace (any size; Small is fine for the demo)
- **Foundation Model API access** — the pay-per-token endpoint `databricks-gte-large-en` must be available in your region. Check with:
  ```bash
  databricks serving-endpoints get databricks-gte-large-en --profile <your-profile>
  ```
  If it's not there, see [Troubleshooting](#troubleshooting) — you can point the app at another embedding endpoint.
- **The companion DAB has been deployed and run** — see [`../youtube-channel-classification/`](../youtube-channel-classification/). Without its output tables, the app has nothing to display.

---

## Required Unity Catalog tables

The app reads from a catalog/schema that the companion DAB populates. Default location: `main.youtube_channels`. Both the location and the individual table names are configurable via `app.yaml` env vars (see [Customization](#customization)) — what's mandatory is the *role* each table plays, not the name.

| Default table name | Env var | Produced by | Purpose |
|---|---|---|---|
| `iab_viz_precomputed` | `TABLE_IAB_VIZ` | DAB job `precompute-viz` | 698 IAB categories + embeddings + t-SNE/UMAP coords + clusters |
| `channels_output` | `TABLE_CHANNELS_OUTPUT` | DAB job `classify-channels-v2` | Classified channels (primary category, confidence, path) |
| `channels_prepped` | `TABLE_CHANNELS_PREPPED` | DAB job `classify-channels-v2` | Channel text used for embedding |
| `channels_embeddings` | `TABLE_CHANNELS_EMBEDDINGS` | DAB job `classify-channels-v2` | Channel embedding vectors |
| `channels_viz_sample` | `TABLE_CHANNELS_VIZ` | DAB job `precompute-viz` | 5,000 channels with 3D coords for Galaxy view |
| `viz_dendrogram_linkage` | `TABLE_DENDROGRAM` | DAB job `precompute-viz` | Pre-computed Ward linkage for dendrogram |

> If you rename tables in your DAB or point at an entirely different dataset, override the corresponding `TABLE_*` env vars in `app.yaml` — no code edits required.

**Deploy order:**
1. `databricks bundle deploy -t dev -p <profile>` (in the DAB folder)
2. `databricks bundle run classify-channels-v2 -t dev -p <profile>`
3. `databricks bundle run precompute-viz -t dev -p <profile>`
4. Then deploy this app.

---

## Service principal permissions

Databricks Apps run as a **service principal** owned by the app. Once you've created the app shell (see [Deploy → First-time setup](#first-time-setup-one-time)), the SP needs three classes of permission:

### 1. Unity Catalog grants

Grant `SELECT` on the tables the app reads (or the whole schema for simplicity):

```sql
GRANT USE CATALOG ON CATALOG main                           TO `<app-service-principal>`;
GRANT USE SCHEMA  ON SCHEMA  main.youtube_channels          TO `<app-service-principal>`;
GRANT SELECT      ON SCHEMA  main.youtube_channels          TO `<app-service-principal>`;
```

You can also do this in the UI: **Catalog Explorer** → pick catalog/schema → **Permissions** → **Grant**.

### 2. SQL Warehouse — `CAN USE`

**Compute** → **SQL Warehouses** → your warehouse → **Permissions** → add the app SP with `Can use`.

### 3. Serving endpoint — `CAN QUERY`

**Serving** → `databricks-gte-large-en` → **Permissions** → add the app SP with `Can query`.

### Finding the app's service principal

In the UI: **Apps** → your app → **Authorization** tab shows the SP name (something like `app-xxxxxx embeddings-explorer`).

Via CLI:
```bash
databricks apps get embeddings-explorer --profile <your-profile> -o json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['service_principal_name'], '/', d['service_principal_client_id'])"
```

---

## Local development setup

Local dev is useful for UI iteration. You'll use a personal access token (PAT) instead of the App's OAuth.

> We don't ship `package-lock.json` — `npm install` resolves against whatever registry your `.npmrc` points at (defaults to public npmjs.org). If you want fully reproducible installs, generate a lockfile locally and don't commit it.

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env
# Edit .env to set CATALOG, SCHEMA, DATABRICKS_HOST, DATABRICKS_WAREHOUSE_ID, DATABRICKS_TOKEN

# 3. Build frontend
npm run build

# 4. Run server
npm start
# visits http://localhost:8000
```

For faster UI iteration with hot-reload, run Vite's dev server in one terminal and the Express backend in another — Vite's `vite.config.js` already proxies `/api/*` to `localhost:8000`:
```bash
npm run dev          # terminal 1 — Vite on :5173
npm start            # terminal 2 — Express on :8000
```

---

## Deploy to Databricks Apps

### First-time setup (one-time)

Follow these steps **in order**. The order matters: the service principal doesn't exist until step 1, and the app will fail to start if resources aren't bound before it runs (step 4).

#### Step 1 — Create the app shell

The app doesn't exist yet at this point. This command creates it and provisions the service principal that will run it.

```bash
databricks apps create embeddings-explorer --profile <your-profile>
```

Takes ~1–2 minutes. Note the `service_principal_name` in the output — you'll use it in step 3.

#### Step 2 — Bind resources (SQL Warehouse + Serving Endpoint)

In the Databricks UI: **Apps** → `embeddings-explorer` → **Resources** tab → **Add resource**. Add both:

| Resource name | Type | Bind to | Permission |
|---|---|---|---|
| `sql-warehouse` | SQL Warehouse | Any serverless warehouse in this workspace | `Can use` |
| `serving-endpoint` | Serving endpoint | `databricks-gte-large-en` (or your chosen embedding endpoint) | `Can query` |

> ⚠️ Both resource names must match `valueFrom:` entries in `app.yaml` — that's how `DATABRICKS_WAREHOUSE_ID` (warehouse ID) and `EMBEDDING_ENDPOINT_NAME` (endpoint name) get injected at process start. If you rename either resource, update `app.yaml` to match.

#### Step 3 — Grant permissions to the service principal

Using the SP name from step 1, run the grants listed in [Service principal permissions](#service-principal-permissions):

- UC: `USE CATALOG`, `USE SCHEMA`, `SELECT` on the catalog/schema the app reads
- SQL Warehouse: `Can use` on the warehouse you bound in step 2
- Serving endpoint: `Can query` on the endpoint you bound in step 2

> Note: Binding a resource in step 2 does **not** automatically grant permission to the underlying warehouse/endpoint — you still need the explicit `Can use` / `Can query` grants. The UI will usually offer to add them when you bind.

#### Step 4 — Deploy the code

From the project root:

```bash
./scripts/deploy.sh <your-profile>
```

This builds the frontend, uploads to `/Workspace/Users/<your-email>/apps/embeddings-explorer`, and runs `databricks apps deploy`. Expected runtime ~1–2 minutes.

#### Step 5 — Verify

See [Verify the deployment](#verify-the-deployment). The first few requests after a fresh start can take ~10–30 s while the SQL warehouse warms and the server caches populate.

> **Gotcha:** If you bound resources (step 2) **after** a prior deploy, the app started without the env vars and will throw `warehouse_id not specified` until you redeploy. Check `databricks apps logs embeddings-explorer -p <profile>` for `Warehouse: not set` on startup — that's the tell. Fix by redeploying: `./scripts/deploy.sh <profile>` again (or click **Deploy** in the UI).

### Deploy (every time you ship a change)

From the project root:

```bash
./scripts/deploy.sh <your-profile>
```

Or via npm:

```bash
DATABRICKS_PROFILE=<your-profile> npm run deploy
```

The script will:
1. Build the frontend with Vite → `dist/`
2. Assemble a minimal `deploy/` (server + prod deps only, ~4 MB)
3. Strip docs/tests from `node_modules`
4. Upload to `/Workspace/Users/<your-email>/apps/embeddings-explorer` (derived from your profile)
5. Run `databricks apps deploy` to activate the new version

Expected runtime: **~1–2 minutes** end-to-end.

### Override the workspace path (optional)

```bash
WORKSPACE_PATH="/Workspace/Shared/apps/embeddings-explorer" \
APP_NAME="my-embeddings-explorer" \
./scripts/deploy.sh <your-profile>
```

---

## Verify the deployment

1. Open the app URL (shown at the end of the deploy script, or in the Databricks Apps UI)
2. Hit the health endpoint: `https://<app-url>/api/health` — should return `{"status":"healthy","catalog":"...","schema":"..."}`
3. Load the **Embedding Space** tab — you should see 698 points rendered in 3D. First load can take ~10s while the server warms its cache.
4. In **Load 0: Classify**, type some channel description text — a ranked list of IAB categories should appear within 1–2 seconds.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Startup log shows `Warehouse: not set` or `warehouse_id not specified` | App started before the `sql-warehouse` resource was bound — env var never populated | Bind the resource in the UI (Apps → app → Resources), then redeploy: `./scripts/deploy.sh <profile>` |
| Startup log shows `error resolving resource sql-warehouse ... not found` | Resource bound under a different name than `sql-warehouse` | Either rename the resource or change `valueFrom` in `app.yaml` — names must match |
| `Table or view not found: iab_viz_precomputed` | Companion DAB's `precompute-viz` job hasn't run | Run the DAB's `precompute-viz` job, then redeploy |
| All API calls 403 / `PERMISSION_DENIED` | Service principal missing UC grants | See [Service principal permissions](#service-principal-permissions) |
| `/api/embed` returns `PERMISSION_DENIED` | SP missing `Can query` on the serving endpoint | Serving → your endpoint → Permissions → grant the app SP `Can query` |
| `/api/embed` returns 404 on the endpoint | `databricks-gte-large-en` not available in your region | Re-bind the `serving-endpoint` Apps resource to a different embedding endpoint (e.g., `bge-large-en`), redeploy, grant the SP `Can query` on the new endpoint. No code change needed. |
| First request takes ~10–30 seconds | Normal — SQL warehouse cold start + in-memory cache warming | Subsequent requests are sub-second while caches are warm |
| Cannot redeploy: "pending deployment in progress for less than 20 minutes" | Deploy was triggered via UI and CLI at the same time | Wait for the pending deployment to finish (`databricks apps get <app> -p <profile>`) |
| Deploy fails with `403` on workspace path | Profile user doesn't have write access to the path | Override with `WORKSPACE_PATH="/Workspace/Shared/apps/..."` |
| `jq: command not found` | Not installed | `brew install jq` or `apt install jq` |
| `error downloading Terraform: unable to verify checksums signature: openpgp: key expired` | Databricks CLI version too old | Upgrade: `brew upgrade databricks` (need ≥ 0.298) |
| 3D view is blank / shows loading spinner | Browser doesn't support WebGL2 | Use a recent Chrome/Edge/Safari; check `about:gpu` |

Check app logs via:
```bash
databricks apps logs embeddings-explorer --profile <your-profile>
```

---

## Customization

### Adapt to a different taxonomy

The Load 0 / Load 1 / confidence-gating pipeline is taxonomy-agnostic. To reuse with, say, product categories instead of IAB:

| Swap | Where |
|---|---|
| Taxonomy / dataset tables | `app.yaml` — `TABLE_IAB_VIZ`, `TABLE_CHANNELS_*`, `TABLE_DENDROGRAM` |
| Embedding endpoint | Re-bind the `serving-endpoint` resource in the Apps UI (no code change) |
| Catalog / schema | `app.yaml` — `CATALOG`, `SCHEMA` |
| Input labels/colors | `src/lib/colors.js` (26 tier-1 colors); tab labels in `src/App.jsx` |
| Tuning thresholds | `src/lib/cosine.js` (gap threshold 0.08), `src/lib/knn.js` (K, weights) |

> The DAB pipeline ([../youtube-channel-classification/](../youtube-channel-classification/)) writes whatever table names *its* config specifies. If you rename tables in the DAB, mirror the rename in `app.yaml`'s `TABLE_*` values.

### Tune thresholds

- **Similarity threshold** (client-side filtering, Load 0): `src/lib/cosine.js`
- **KNN weights** (Load 0 vs KNN support blend, Load 1): `src/lib/knn.js`
- **Confidence gap** for multi-label (`gapFromFirst > 0.08`): `src/lib/cosine.js`

### Point at different tables / catalog

Edit `CATALOG`, `SCHEMA`, and the `TABLE_*` values in `app.yaml` and redeploy. For per-environment overrides, create multiple app shells (e.g., `embeddings-explorer-dev`, `-prod`) and bind each to its own catalog/schema.

---

## Where next

### In this repo

- **[`TECHNICAL_GUIDE.md`](TECHNICAL_GUIDE.md)** — comprehensive technical reference: architecture, API, auth, caching, 3D rendering, performance, customization
- **[`docs/`](docs/)** — focused deep-dives:
  - [3D Visualization](docs/3d-visualization.md) — instancedMesh, t-SNE vs UMAP, LOD labels, performance patterns
  - [API Reference](docs/api-reference.md) — every route documented with SQL, request/response shapes, gotchas
  - [Authentication](docs/auth.md) — Databricks Apps OAuth, local PAT, switching to on-behalf-of-user
- **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — compact structural notes (route list, component inventory, gotchas)

### Companion DAB pipeline

- **[`../youtube-channel-classification/`](../youtube-channel-classification/)** — the batch pipeline that produces the UC tables this app reads
- **[`../youtube-channel-classification/TECHNICAL_GUIDE.md`](../youtube-channel-classification/TECHNICAL_GUIDE.md)** — ML deep-dive (Load 0 / Load 1 / embeddings / threshold tuning / scale)
- **[`../youtube-channel-classification/docs/cosine-similarity.md`](../youtube-channel-classification/docs/cosine-similarity.md)** — the math powering Load 0 classification (with diagrams)
