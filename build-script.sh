#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f package.json ]]; then
  echo "No package.json found. Nothing to build."
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to build the frontend." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "Building frontend bundle..."
if ! npm run build; then
  echo "Initial build failed. Attempting to rebuild esbuild for this platform..."
  npm rebuild esbuild
  npm run build
fi

echo "Build complete. Assets located in static/"
