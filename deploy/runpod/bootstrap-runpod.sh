#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-${QWEN_PROFILE:-32b}}"
REPO_URL="${REPO_URL:-https://github.com/L-Ayim/Awal_docker.git}"
WORKDIR="${WORKDIR:-/workspace/Awal}"
LOG_DIR="${AWAL_LOG_DIR:-/workspace/logs}"
VOLUME_DIR="${AWAL_VOLUME_DIR:-/workspace}"
VENV_DIR="${AWAL_VENV_DIR:-/workspace/venvs/awal-runtime}"
FAST_START="${RUNPOD_FAST_START:-0}"
FORCE_INSTALL="${RUNPOD_FORCE_INSTALL:-0}"
DEPS_STAMP="$VOLUME_DIR/.awal-runtime-deps-v2"
KEEPALIVE="${RUNPOD_KEEPALIVE:-1}"

VLLM_API_KEY="${VLLM_API_KEY:-awal-runpod-key}"
DOC_PROCESSOR_API_KEY="${DOC_PROCESSOR_API_KEY:-awal-docling-key}"
EMBEDDING_API_KEY="${EMBEDDING_API_KEY:-awal-embedding-key}"
RERANK_API_KEY="${RERANK_API_KEY:-awal-rerank-key}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-BAAI/bge-m3}"
RERANK_MODEL="${RERANK_MODEL:-BAAI/bge-reranker-v2-m3}"
DOCLING_DEVICE="${DOCLING_DEVICE:-cuda}"
ENABLE_RERANK="${ENABLE_RERANK:-0}"
HF_HOME="${HF_HOME:-/workspace/.cache/huggingface}"

log() {
  printf '\n==> %s\n' "$*"
}

install_os_packages() {
  if [ "$FAST_START" = "1" ] && command -v git >/dev/null 2>&1 && command -v rclone >/dev/null 2>&1; then
    log "Skipping OS package install because RUNPOD_FAST_START=1 and required tools exist"
    return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    log "Installing OS packages"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      procps \
      rclone
  fi
}

prepare_volume() {
  log "Preparing RunPod network volume directories under $VOLUME_DIR"
  mkdir -p \
    "$VOLUME_DIR/models" \
    "$VOLUME_DIR/loras" \
    "$VOLUME_DIR/checkpoints" \
    "$VOLUME_DIR/outputs" \
    "$VOLUME_DIR/logs" \
    "$(dirname "$VENV_DIR")" \
    "$HF_HOME"
}

prepare_repo() {
  log "Preparing repo at $WORKDIR"
  mkdir -p "$(dirname "$WORKDIR")" "$LOG_DIR"

  if [ -d "$WORKDIR/.git" ]; then
    git -C "$WORKDIR" pull --ff-only
  else
    rm -rf "$WORKDIR"
    git clone "$REPO_URL" "$WORKDIR"
  fi
}

install_python_dependencies() {
  if [ "$FAST_START" = "1" ] && [ "$FORCE_INSTALL" != "1" ] && [ -x "$VENV_DIR/bin/python" ] && { [ -f "$DEPS_STAMP" ] || [ "$VENV_DIR" = "/opt/awal-venv" ]; }; then
    log "Skipping Python dependency install because prepared runtime exists at $VENV_DIR"
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
    return 0
  fi

  log "Installing Python dependencies into $VENV_DIR"
  cd "$WORKDIR"

  python -m venv "$VENV_DIR"
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"

  python -m pip install --upgrade pip

  if ! command -v vllm >/dev/null 2>&1; then
    python -m pip install vllm
  fi

  python -m pip install \
    -r requirements-docling-service.txt \
    -r requirements-embedding-service.txt \
    -r requirements-rerank-service.txt

  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$DEPS_STAMP"
}

start_service() {
  local name="$1"
  local pattern="$2"
  shift 2

  log "Starting $name"
  pkill -f "$pattern" >/dev/null 2>&1 || true
  nohup "$@" > "$LOG_DIR/$name.log" 2>&1 &
  sleep 2
}

start_services() {
  cd "$WORKDIR"
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"

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
  else
    log "Skipping rerank because ENABLE_RERANK is not 1"
    pkill -f "scripts.rerank_service" >/dev/null 2>&1 || true
  fi

  start_service "vllm" "vllm serve" \
    env API_KEY="$VLLM_API_KEY" HF_HOME="$HF_HOME" PATH="$VENV_DIR/bin:$PATH" \
    bash "$WORKDIR/deploy/runpod/vllm/run-qwen3.sh" "$PROFILE"
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local header="${3:-}"
  local attempts="${4:-90}"

  log "Waiting for $label"
  for _ in $(seq 1 "$attempts"); do
    if [ -n "$header" ]; then
      if curl -fsS "$url" -H "$header" >/dev/null 2>&1; then
        echo "$label ready: $url"
        return 0
      fi
    else
      if curl -fsS "$url" >/dev/null 2>&1; then
        echo "$label ready: $url"
        return 0
      fi
    fi
    sleep 5
  done

  echo "$label did not become ready. Check logs in $LOG_DIR." >&2
  return 1
}

print_status() {
  log "Service status"
  curl -s http://127.0.0.1:8010/health || true
  echo
  curl -s http://127.0.0.1:8020/health || true
  echo
  if [ "$ENABLE_RERANK" = "1" ]; then
    curl -s http://127.0.0.1:8030/health || true
    echo
  fi
  curl -s http://127.0.0.1:8000/v1/models -H "Authorization: Bearer $VLLM_API_KEY" || true
  echo

  cat <<EOF

RunPod volume:
  $VOLUME_DIR

Ports:
  http://localhost:8000  vLLM/Qwen
  http://localhost:8010  Docling
  http://localhost:8020  embeddings
  http://localhost:8030  rerank, optional only if ENABLE_RERANK=1

Logs:
  tail -f $LOG_DIR/vllm.log
  tail -f $LOG_DIR/docling.log
  tail -f $LOG_DIR/embedding.log
  tail -f $LOG_DIR/rerank.log  # only if ENABLE_RERANK=1
EOF
}

keep_container_alive() {
  if [ "$KEEPALIVE" != "1" ]; then
    return 0
  fi

  log "Keeping RunPod container alive"
  touch "$LOG_DIR/vllm.log" "$LOG_DIR/docling.log" "$LOG_DIR/embedding.log"
  tail -n 80 -F "$LOG_DIR/vllm.log" "$LOG_DIR/docling.log" "$LOG_DIR/embedding.log"
}

install_os_packages
prepare_volume
prepare_repo
install_python_dependencies
start_services

wait_for_http "Docling" "http://127.0.0.1:8010/health" "" 60 || true
wait_for_http "Embeddings" "http://127.0.0.1:8020/health" "" 90 || true
if [ "$ENABLE_RERANK" = "1" ]; then
  wait_for_http "Rerank" "http://127.0.0.1:8030/health" "" 90 || true
fi
wait_for_http "vLLM" "http://127.0.0.1:8000/v1/models" "Authorization: Bearer $VLLM_API_KEY" 240 || true
print_status
keep_container_alive
