#!/usr/bin/env bash
set -euo pipefail

B2_REMOTE="${B2_REMOTE:-b2}"
B2_BUCKET="${B2_BUCKET:-awal-ai-storage}"
VOLUME_DIR="${AWAL_VOLUME_DIR:-/workspace}"

mkdir -p \
  "$VOLUME_DIR/models" \
  "$VOLUME_DIR/loras" \
  "$VOLUME_DIR/checkpoints" \
  "$VOLUME_DIR/outputs" \
  "$VOLUME_DIR/logs"

echo "Syncing model/runtime data from ${B2_REMOTE}:${B2_BUCKET} into ${VOLUME_DIR}"

rclone copy "${B2_REMOTE}:${B2_BUCKET}/models" "$VOLUME_DIR/models" --progress
rclone copy "${B2_REMOTE}:${B2_BUCKET}/loras" "$VOLUME_DIR/loras" --progress || true
rclone copy "${B2_REMOTE}:${B2_BUCKET}/checkpoints" "$VOLUME_DIR/checkpoints" --progress || true
