#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[deploy] Installing deps"
npm ci

echo "[deploy] Building"
npm run build

echo "[deploy] Deploying to Netlify"
if [[ -n "${NETLIFY_AUTH_TOKEN:-}" && -n "${NETLIFY_SITE_ID:-}" ]]; then
  npx netlify-cli deploy --prod --dir "apps/web/dist" --site "$NETLIFY_SITE_ID" --auth "$NETLIFY_AUTH_TOKEN"
else
  echo "[deploy] NETLIFY_AUTH_TOKEN/NETLIFY_SITE_ID not set; falling back to interactive Netlify CLI deploy."
  npx netlify-cli deploy --prod --dir "apps/web/dist"
fi

