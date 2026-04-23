#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Deploy the Embeddings Explorer app to a Databricks workspace.
#
# DEMO IMPLEMENTATION — reference asset intended for adaptation.
#
# Usage:
#   ./scripts/deploy.sh [PROFILE]
#
# Configuration (via args or env vars):
#   DATABRICKS_PROFILE — Databricks CLI profile (required; can also pass as arg 1)
#   APP_NAME           — Databricks App name (default: embeddings-explorer)
#   WORKSPACE_PATH     — Workspace import path
#                        (default: /Users/<profile-user-email>/apps/<APP_NAME>)
#
# Requires: databricks CLI (>= 0.220), node, jq
# =============================================================================

PROFILE="${1:-${DATABRICKS_PROFILE:-}}"
APP_NAME="${APP_NAME:-embeddings-explorer}"

if [[ -z "$PROFILE" ]]; then
  cat >&2 <<'EOF'
Error: Databricks CLI profile not set.

Usage:  ./scripts/deploy.sh <profile>
   or:  DATABRICKS_PROFILE=<profile> ./scripts/deploy.sh

Configure profiles with:  databricks configure
List profiles with:       databricks auth profiles
EOF
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: 'jq' is required to parse Databricks CLI output." >&2
  echo "Install:  brew install jq   (macOS)" >&2
  echo "         apt install jq    (Debian/Ubuntu)" >&2
  exit 1
fi

# Derive workspace path from the profile's authenticated user if not provided.
if [[ -z "${WORKSPACE_PATH:-}" ]]; then
  USER_EMAIL=$(databricks current-user me --profile "$PROFILE" -o json | jq -r '.userName')
  if [[ -z "$USER_EMAIL" || "$USER_EMAIL" == "null" ]]; then
    echo "Error: could not resolve user for profile '$PROFILE'. Check your CLI auth." >&2
    exit 1
  fi
  WORKSPACE_PATH="/Users/${USER_EMAIL}/apps/${APP_NAME}"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="$PROJECT_DIR/deploy"

echo "=== Deploy target ==="
echo "  Profile:        $PROFILE"
echo "  App name:       $APP_NAME"
echo "  Workspace path: $WORKSPACE_PATH"
echo ""

echo "=== Building frontend ==="
cd "$PROJECT_DIR"
npx vite build

echo "=== Assembling deploy package ==="
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

# Copy only what the server needs at runtime
cp app.yaml server.js "$DEPLOY_DIR/"
cp -r lib dist "$DEPLOY_DIR/"

# Create a minimal package.json with server-only deps
cat > "$DEPLOY_DIR/package.json" << 'EOF'
{
  "name": "embeddings-explorer",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "compression": "^1.7.4",
    "express": "^4.22.1"
  }
}
EOF

# Install production deps only
cd "$DEPLOY_DIR"
npm install

# Strip non-essential files and dirs from node_modules
find node_modules -type d \( \
  -name 'test' -o -name 'tests' -o -name '__tests__' \
  -o -name '.github' -o -name 'example' -o -name 'examples' \
  -o -name 'bench' -o -name 'benchmark' \
\) -exec rm -rf {} + 2>/dev/null || true

find node_modules -type f \( \
  -name '*.md' -o -name '*.ts' -o -name '*.yml' -o -name '*.yaml' \
  -o -name '*.markdown' -o -name '*.map' \
  -o -name 'LICENSE*' -o -name 'HISTORY*' -o -name 'CHANGELOG*' \
  -o -name 'tsconfig.json' -o -name '.eslintrc*' -o -name '.nycrc' \
  -o -name '.editorconfig' -o -name '.npmignore' -o -name '.gitattributes' \
  -o -name 'Makefile' -o -name '.travis.yml' \
\) -delete
rm -rf node_modules/.bin node_modules/.package-lock.json package-lock.json

# Report
FILE_COUNT=$(find . -type f | wc -l | tr -d ' ')
SIZE=$(du -sh . | cut -f1)
echo ""
echo "=== Deploy package ready ==="
echo "  Files: $FILE_COUNT"
echo "  Size:  $SIZE"
echo "  Path:  $DEPLOY_DIR"

echo ""
echo "=== Uploading to workspace ==="
databricks workspace import-dir "$DEPLOY_DIR" "$WORKSPACE_PATH" --overwrite --profile "$PROFILE"

echo ""
echo "=== Deploying app ==="
databricks apps deploy "$APP_NAME" \
  --source-code-path "/Workspace$WORKSPACE_PATH" \
  --profile "$PROFILE"

echo ""
echo "=== Done ==="
echo "  App:   $APP_NAME"
echo "  View:  https://<your-workspace-host>/apps/$APP_NAME"
