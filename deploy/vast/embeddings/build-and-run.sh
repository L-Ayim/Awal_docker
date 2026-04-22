#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-awal-embedding-service}"
CONTAINER_NAME="${CONTAINER_NAME:-awal-embedding-service}"
PORT="${PORT:-8020}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-BAAI/bge-m3}"

docker build \
  -f deploy/vast/embeddings/Dockerfile \
  -t "$IMAGE_NAME" \
  .

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:8020" \
  -e EMBEDDING_API_KEY="${EMBEDDING_API_KEY:-}" \
  -e EMBEDDING_MODEL="${EMBEDDING_MODEL}" \
  "$IMAGE_NAME"

echo "Embedding service started on port ${PORT}"
