#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-${QWEN_PROFILE:-32b}}"

case "$PROFILE" in
  8b)
    DEFAULT_MODEL_NAME="Qwen/Qwen3-8B"
    DEFAULT_MAX_MODEL_LEN="4096"
    DEFAULT_GPU_MEMORY_UTILIZATION="0.75"
    ;;
  14b)
    DEFAULT_MODEL_NAME="Qwen/Qwen3-14B"
    DEFAULT_MAX_MODEL_LEN="4096"
    DEFAULT_GPU_MEMORY_UTILIZATION="0.82"
    ;;
  32b)
    DEFAULT_MODEL_NAME="Qwen/Qwen3-32B"
    DEFAULT_MAX_MODEL_LEN="8192"
    DEFAULT_GPU_MEMORY_UTILIZATION="0.88"
    ;;
  *)
    echo "Unknown Qwen profile: $PROFILE" >&2
    echo "Use one of: 8b, 14b, 32b" >&2
    exit 2
    ;;
esac

MODEL_NAME="${MODEL_NAME:-$DEFAULT_MODEL_NAME}"
API_KEY="${API_KEY:-awal-runpod-key}"
PORT="${PORT:-8000}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-$DEFAULT_MAX_MODEL_LEN}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-$DEFAULT_GPU_MEMORY_UTILIZATION}"
HF_HOME="${HF_HOME:-/workspace/hf-cache}"

mkdir -p "$HF_HOME" /workspace/models /workspace/logs /workspace/outputs /workspace/checkpoints

echo "Starting vLLM profile=$PROFILE model=$MODEL_NAME port=$PORT max_model_len=$MAX_MODEL_LEN gpu_memory_utilization=$GPU_MEMORY_UTILIZATION hf_home=$HF_HOME"

vllm serve "$MODEL_NAME" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --api-key "$API_KEY" \
  --dtype auto \
  --generation-config vllm \
  --enforce-eager \
  --max-model-len "$MAX_MODEL_LEN" \
  --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION"
