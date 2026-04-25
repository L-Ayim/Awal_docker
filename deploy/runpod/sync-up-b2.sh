#!/usr/bin/env bash
set -euo pipefail

B2_REMOTE="${B2_REMOTE:-b2}"
B2_BUCKET="${B2_BUCKET:-awal-ai-storage}"
VOLUME_DIR="${AWAL_VOLUME_DIR:-/workspace}"

echo "Syncing outputs/checkpoints/logs from ${VOLUME_DIR} into ${B2_REMOTE}:${B2_BUCKET}"

rclone copy "$VOLUME_DIR/checkpoints" "${B2_REMOTE}:${B2_BUCKET}/checkpoints" --progress || true
rclone copy "$VOLUME_DIR/outputs" "${B2_REMOTE}:${B2_BUCKET}/outputs" --progress || true
rclone copy "$VOLUME_DIR/logs" "${B2_REMOTE}:${B2_BUCKET}/logs" --progress || true
