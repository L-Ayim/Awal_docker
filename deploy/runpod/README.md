# RunPod 32B Deployment

This folder is the RunPod version of the GPU runtime. It is designed for a RunPod Network Volume mounted at `/workspace`, with Backblaze B2 used as durable backup storage.

## Target Architecture

- RunPod Network Volume: hot cache and working disk
- Backblaze B2: permanent object storage backup
- RunPod GPU Pod: disposable compute
- vLLM: OpenAI-compatible generation API
- Docling, embeddings, rerank: supporting services

## Recommended First Production Test

- Network volume: `johnson-32b-cache`, 400 GB or larger
- GPU: `RTX PRO 6000` for comfortable 32B operation, or `H200 SXM` for premium capacity testing
- Generation model: `Qwen/Qwen3-32B`
- Embeddings: `BAAI/bge-m3`
- Rerank: disabled first, enabled only if the GPU has spare VRAM

## Bring-Up With Compose

On the RunPod Pod, clone the repo onto the network volume:

```bash
cd /workspace
git clone https://github.com/L-Ayim/Awal_docker.git Awal
cd /workspace/Awal/deploy/runpod
cp .env.runtime.example .env.runtime
docker compose --env-file .env.runtime -f docker-compose.gpu.yml up -d --build
```

Health checks:

```bash
curl http://127.0.0.1:8000/v1/models -H "Authorization: Bearer awal-runpod-key"
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8020/health
```

## Bring-Up With Bootstrap Script

For a fresh RunPod PyTorch image:

```bash
curl -fsSL https://raw.githubusercontent.com/L-Ayim/Awal_docker/main/deploy/runpod/bootstrap-runpod.sh | bash -s -- 32b
```

The script keeps repo files, Hugging Face cache, logs, outputs, and checkpoints under `/workspace` so they survive Pod deletion when using a Network Volume.

## Backblaze B2 Sync

Configure `rclone` for Backblaze B2 once on the Pod or via environment-backed config. Then:

```bash
cd /workspace/Awal
B2_REMOTE=b2 B2_BUCKET=awal-ai-storage bash deploy/runpod/sync-down-b2.sh
B2_REMOTE=b2 B2_BUCKET=awal-ai-storage bash deploy/runpod/sync-up-b2.sh
```

Use B2 as the master copy for:

- `models/`
- `loras/`
- `checkpoints/`
- `outputs/`
- `logs/`

Use the RunPod Network Volume as the hot local cache.

## App Environment

The Next.js app still uses the existing OpenAI-compatible env names:

```bash
VAST_OPENAI_BASE_URL="http://<runpod-ip-or-proxy>:8000/v1"
VAST_OPENAI_API_KEY="awal-runpod-key"
VAST_LLM_MODEL="Qwen/Qwen3-32B"

DOC_PROCESSOR_BASE_URL="http://<runpod-ip-or-proxy>:8010"
DOC_PROCESSOR_API_KEY="awal-docling-key"
EMBEDDING_BASE_URL="http://<runpod-ip-or-proxy>:8020"
EMBEDDING_API_KEY="awal-embedding-key"
```

The name `VAST_OPENAI_*` is retained for compatibility; it can point to RunPod, Vast, or any OpenAI-compatible vLLM endpoint.

## Cost Controls

For testing, stop or terminate the Pod when idle. The Network Volume remains mounted data storage and keeps `/workspace` for the next Pod.

For client production, contract language should say "managed capacity up to one H200-equivalent instance" rather than "unlimited H200 usage."
