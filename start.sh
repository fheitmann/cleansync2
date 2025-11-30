#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
APP_MODULE="${APP_MODULE:-app.main:app}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
VENV_PATH="${VENV_PATH:-$ROOT_DIR/.venv}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
RELOAD="${RELOAD:-0}"
RELOAD_DIRS="${RELOAD_DIRS:-app frontend.jsx}"
RELOAD_EXCLUDES="${RELOAD_EXCLUDES:-.venv storage}"

# Load optional environment variables (e.g., Gemini API keys).
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

if [[ ! -d "$VENV_PATH" ]]; then
  echo "Creating virtual environment at $VENV_PATH"
  "$PYTHON_BIN" -m venv "$VENV_PATH"
fi

# shellcheck source=/dev/null
source "$VENV_PATH/bin/activate"

pip install --upgrade pip >/dev/null
pip install -r "$ROOT_DIR/requirements.txt"

if [[ -f "$ROOT_DIR/package.json" ]]; then
  if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
    echo "Installing frontend dependencies..."
    (cd "$ROOT_DIR" && npm install >/dev/null)
  fi
  echo "Building frontend assets..."
  (cd "$ROOT_DIR" && npm run build >/dev/null)
fi

echo "Starting CleanSync API → http://$HOST:$PORT"

UVICORN_ARGS=(--host "$HOST" --port "$PORT")
if [[ "$RELOAD" == "1" ]]; then
  UVICORN_ARGS+=(--reload)
  for dir in $RELOAD_DIRS; do
    UVICORN_ARGS+=(--reload-dir "$dir")
  done
  for pattern in $RELOAD_EXCLUDES; do
    UVICORN_ARGS+=(--reload-exclude "$pattern")
  done
fi

cd "$ROOT_DIR"
exec uvicorn "$APP_MODULE" "${UVICORN_ARGS[@]}"
