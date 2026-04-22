#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-awal-docling-service}"
CONTAINER_NAME="${CONTAINER_NAME:-awal-docling-service}"
PORT="${PORT:-8010}"
DOCLING_DEVICE="${DOCLING_DEVICE:-cuda}"
TORCH_WHEEL_INDEX_URL="${TORCH_WHEEL_INDEX_URL:-https://download.pytorch.org/whl/cu128}"

docker build \
  -f deploy/vast/docling/Dockerfile \
  --build-arg TORCH_WHEEL_INDEX_URL="$TORCH_WHEEL_INDEX_URL" \
  -t "$IMAGE_NAME" \
  .

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --gpus all \
  -p "${PORT}:8010" \
  -e DOC_PROCESSOR_API_KEY="${DOC_PROCESSOR_API_KEY:-}" \
  -e DOCLING_DEVICE="${DOCLING_DEVICE}" \
  "$IMAGE_NAME"

echo "Docling service started on port ${PORT}"
