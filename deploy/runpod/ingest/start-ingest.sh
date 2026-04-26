#!/usr/bin/env bash
set -euo pipefail

WORKDIR="${WORKDIR:-/workspace/Awal}"
LOG_DIR="${AWAL_LOG_DIR:-/workspace/logs}"
VOLUME_DIR="${AWAL_VOLUME_DIR:-/workspace}"
VENV_DIR="${AWAL_INGEST_VENV_DIR:-/workspace/venvs/awal-ingest}"
FAST_START="${RUNPOD_FAST_START:-1}"
FORCE_INSTALL="${RUNPOD_FORCE_INSTALL:-0}"
VENV_SYSTEM_SITE_PACKAGES="${AWAL_VENV_SYSTEM_SITE_PACKAGES:-1}"
DEPS_STAMP="$VOLUME_DIR/.awal-ingest-deps-v1"
DOC_PROCESSOR_API_KEY="${DOC_PROCESSOR_API_KEY:-awal-docling-key}"
EMBEDDING_API_KEY="${EMBEDDING_API_KEY:-awal-embedding-key}"
RERANK_API_KEY="${RERANK_API_KEY:-awal-rerank-key}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-BAAI/bge-m3}"
RERANK_MODEL="${RERANK_MODEL:-BAAI/bge-reranker-v2-m3}"
DOCLING_DEVICE="${DOCLING_DEVICE:-cuda}"
ENABLE_RERANK="${ENABLE_RERANK:-0}"
KEEPALIVE="${RUNPOD_KEEPALIVE:-1}"

log() {
  printf '\n==> %s\n' "$*"
}

install_os_packages() {
  if [ "$FAST_START" = "1" ] && command -v git >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
    log "Skipping OS package install because required tools exist"
    return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    log "Installing OS packages"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      procps
  fi
}

install_python_dependencies() {
  if [ "$FAST_START" = "1" ] && [ "$FORCE_INSTALL" != "1" ] && [ -x "$VENV_DIR/bin/python" ] && [ -f "$DEPS_STAMP" ]; then
    log "Skipping Python dependency install because prepared ingest runtime exists at $VENV_DIR"
    return 0
  fi

  log "Installing ingest Python dependencies into $VENV_DIR"
  cd "$WORKDIR"

  if [ -d "$VENV_DIR" ] && [ ! -f "$DEPS_STAMP" ]; then
    log "Removing incomplete ingest runtime at $VENV_DIR"
    rm -rf "$VENV_DIR"
  fi

  mkdir -p "$(dirname "$VENV_DIR")"

  if [ "$VENV_SYSTEM_SITE_PACKAGES" = "1" ]; then
    python -m venv --system-site-packages "$VENV_DIR"
  else
    python -m venv "$VENV_DIR"
  fi

  "$VENV_DIR/bin/python" -m pip install --upgrade pip

  export PIP_NO_CACHE_DIR=1
  "$VENV_DIR/bin/python" -m pip install \
    -r requirements-docling-service.txt \
    -r requirements-embedding-service.txt \
    -r requirements-rerank-service.txt

  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$DEPS_STAMP"
}

mkdir -p "$WORKDIR" "$LOG_DIR" "$VOLUME_DIR/.cache/huggingface" "$(dirname "$VENV_DIR")"

if [ -d /opt/awal/deploy/runpod ]; then
  rsync -a --delete --exclude .git /opt/awal/ "$WORKDIR/"
fi

install_os_packages
install_python_dependencies

start_service() {
  local name="$1"
  local pattern="$2"
  shift 2

  echo "Starting $name"
  pkill -f "$pattern" >/dev/null 2>&1 || true
  nohup "$@" > "$LOG_DIR/$name.log" 2>&1 &
  sleep 2
}

cd "$WORKDIR"

start_service "docling" "scripts.docling_service" \
  env DOC_PROCESSOR_API_KEY="$DOC_PROCESSOR_API_KEY" DOCLING_DEVICE="$DOCLING_DEVICE" \
  "$VENV_DIR/bin/python" -m uvicorn scripts.docling_service:app --host 0.0.0.0 --port 8010 --app-dir "$WORKDIR"

start_service "embedding" "scripts.embedding_service" \
  env EMBEDDING_API_KEY="$EMBEDDING_API_KEY" EMBEDDING_MODEL="$EMBEDDING_MODEL" \
  "$VENV_DIR/bin/python" -m uvicorn scripts.embedding_service:app --host 0.0.0.0 --port 8020 --app-dir "$WORKDIR"

if [ "$ENABLE_RERANK" = "1" ]; then
  start_service "rerank" "scripts.rerank_service" \
    env RERANK_API_KEY="$RERANK_API_KEY" RERANK_MODEL="$RERANK_MODEL" \
    "$VENV_DIR/bin/python" -m uvicorn scripts.rerank_service:app --host 0.0.0.0 --port 8030 --app-dir "$WORKDIR"
fi

echo "Awal ingest runtime started"
curl -fsS http://127.0.0.1:8010/health || true
echo
curl -fsS http://127.0.0.1:8020/health || true
echo

if [ "$KEEPALIVE" = "1" ]; then
  touch "$LOG_DIR/docling.log" "$LOG_DIR/embedding.log" "$LOG_DIR/rerank.log"
  tail -n 80 -F "$LOG_DIR/docling.log" "$LOG_DIR/embedding.log" "$LOG_DIR/rerank.log"
fi
