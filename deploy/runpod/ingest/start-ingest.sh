#!/usr/bin/env bash
set -euo pipefail

WORKDIR="${WORKDIR:-/workspace/Awal}"
LOG_DIR="${AWAL_LOG_DIR:-/workspace/logs}"
VENV_DIR="${AWAL_INGEST_VENV_DIR:-/opt/awal-ingest-venv}"
DOC_PROCESSOR_API_KEY="${DOC_PROCESSOR_API_KEY:-awal-docling-key}"
EMBEDDING_API_KEY="${EMBEDDING_API_KEY:-awal-embedding-key}"
RERANK_API_KEY="${RERANK_API_KEY:-awal-rerank-key}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-BAAI/bge-m3}"
RERANK_MODEL="${RERANK_MODEL:-BAAI/bge-reranker-v2-m3}"
DOCLING_DEVICE="${DOCLING_DEVICE:-cuda}"
ENABLE_RERANK="${ENABLE_RERANK:-0}"
KEEPALIVE="${RUNPOD_KEEPALIVE:-1}"

mkdir -p "$WORKDIR" "$LOG_DIR" /workspace/.cache/huggingface

if [ -d /opt/awal/deploy/runpod ]; then
  rsync -a --delete --exclude .git /opt/awal/ "$WORKDIR/"
fi

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
