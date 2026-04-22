#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-awal-docling-service}"
CONTAINER_NAME="${CONTAINER_NAME:-awal-docling-service}"
PORT="${PORT:-8010}"

docker build \
  -f deploy/vast/docling/Dockerfile \
  -t "$IMAGE_NAME" \
  .

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:8010" \
  -e DOC_PROCESSOR_API_KEY="${DOC_PROCESSOR_API_KEY:-}" \
  "$IMAGE_NAME"

echo "Docling service started on port ${PORT}"
