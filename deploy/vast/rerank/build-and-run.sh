#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-awal-rerank-service}"
CONTAINER_NAME="${CONTAINER_NAME:-awal-rerank-service}"
PORT="${PORT:-8030}"
RERANK_MODEL="${RERANK_MODEL:-BAAI/bge-reranker-v2-m3}"

docker build \
  -f deploy/vast/rerank/Dockerfile \
  -t "$IMAGE_NAME" \
  .

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:8030" \
  -e RERANK_API_KEY="${RERANK_API_KEY:-}" \
  -e RERANK_MODEL="${RERANK_MODEL}" \
  "$IMAGE_NAME"

echo "Rerank service started on port ${PORT}"
