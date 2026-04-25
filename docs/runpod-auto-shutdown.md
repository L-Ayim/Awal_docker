# RunPod Auto Shutdown

Awal can save GPU cost by terminating RunPod Pods when no one is using the model. With a RunPod Network Volume, the Pod is disposable and `/workspace` survives on the volume.

## Key Rule

RunPod Pods attached to Network Volumes are not the thing we preserve. The volume is.

Idle flow:

```text
no requests for 20-30 minutes
  -> sync outputs/logs/checkpoints to Backblaze B2
  -> terminate RunPod Pod
  -> keep Network Volume
```

Wake flow:

```text
new request arrives
  -> create RunPod Pod with networkVolumeId
  -> mount /workspace
  -> run Awal bootstrap
  -> wait for vLLM /v1/models
  -> route request to the model
```

RunPod documents that Network Volumes retain data when compute is terminated, and Pods with Network Volumes are created with `networkVolumeId`.

## Controller Script

The repo includes:

```bash
node scripts/runpod-controller.mjs status
node scripts/runpod-controller.mjs wake
node scripts/runpod-controller.mjs sleep
```

Required environment:

```bash
RUNPOD_API_KEY="..."
RUNPOD_NETWORK_VOLUME_ID="5j7pt6oruc"
RUNPOD_DATA_CENTER_ID="US-NE-1"
```

Recommended environment:

```bash
RUNPOD_POD_NAME_PREFIX="awal-32b"
RUNPOD_GPU_TYPE_IDS="NVIDIA RTX PRO 6000 Blackwell Server Edition,NVIDIA H200,NVIDIA H100 80GB HBM3"
RUNPOD_GPU_COUNT="1"
RUNPOD_CONTAINER_DISK_GB="50"
RUNPOD_IMAGE="runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04"
QWEN_PROFILE="32b"
VLLM_API_KEY="awal-runpod-key"
```

To wait until the model endpoint is healthy:

```bash
RUNPOD_WAIT_FOR_HEALTH=1 node scripts/runpod-controller.mjs wake
```

To terminate the active Pod:

```bash
RUNPOD_CONFIRM_TERMINATE=1 node scripts/runpod-controller.mjs sleep
```

The terminate command intentionally requires confirmation because it deletes container disk data. Anything important must be under `/workspace` or synced to Backblaze.

## Backblaze Sync Before Sleep

Before terminating a production Pod, run:

```bash
cd /workspace/Awal
B2_REMOTE=b2 B2_BUCKET=awal-ai-storage bash deploy/runpod/sync-up-b2.sh
```

The controller is intentionally separate from the B2 sync because the sync runs inside the Pod, while the controller can run from the app backend, a small scheduler, or an admin machine.

## App-Managed Automation

Awal now has app-managed runtime state in the `GpuRuntime` table. Model and embedding calls resolve endpoints through the runtime controller instead of relying only on static Fly secrets.

```text
user sends a question
  -> Awal records lastRequestAt
  -> if runtime is ready, Awal health-checks the stored endpoint
  -> if the stored endpoint is stale, Awal refreshes RunPod state
  -> if no active Pod exists, Awal creates a new Pod on the Network Volume
  -> Awal waits for /v1/models
  -> the request continues against the fresh endpoint
```

Set these Fly secrets to enable it:

```powershell
fly secrets set `
  RUNPOD_AUTOMATION_ENABLED="1" `
  RUNPOD_API_KEY="..." `
  RUNPOD_NETWORK_VOLUME_ID="5j7pt6oruc" `
  RUNPOD_DATA_CENTER_ID="US-NE-1" `
  RUNPOD_POD_NAME_PREFIX="awal-32b" `
  RUNPOD_IDLE_MINUTES="45" `
  GPU_RUNTIME_ADMIN_KEY="..." `
  VLLM_API_KEY="awal-runpod-key" `
  DOC_PROCESSOR_API_KEY="awal-docling-key" `
  EMBEDDING_API_KEY="awal-embedding-key" `
  VAST_OPENAI_API_KEY="awal-runpod-key"
```

Admin endpoints:

```bash
curl https://awal-app.fly.dev/api/v1/gpu-runtime

curl -X POST https://awal-app.fly.dev/api/v1/gpu-runtime/wake?wait=1 \
  -H "Authorization: Bearer $GPU_RUNTIME_ADMIN_KEY"

curl -X POST https://awal-app.fly.dev/api/v1/gpu-runtime/sleep \
  -H "Authorization: Bearer $GPU_RUNTIME_ADMIN_KEY"

curl -X POST https://awal-app.fly.dev/api/v1/gpu-runtime/idle-check \
  -H "Authorization: Bearer $GPU_RUNTIME_ADMIN_KEY"
```

The chat UI polls runtime status while a response is pending. If the Pod is cold, the composer shows that the model is waking up instead of appearing frozen.

## Idle Shutdown Schedule

Use an external scheduler such as GitHub Actions, cron-job.org, or a tiny always-on worker to call the idle-check endpoint every 5 minutes:

```text
*/5 * * * * POST /api/v1/gpu-runtime/idle-check
```

If `lastRequestAt` is older than `RUNPOD_IDLE_MINUTES`, Awal terminates the RunPod Pod and keeps the Network Volume.

## Faster Cold Starts

The bootstrap script supports a prepared-volume fast path:

```bash
RUNPOD_FAST_START=1
AWAL_VENV_DIR=/workspace/venvs/awal-runtime
HF_HOME=/workspace/.cache/huggingface
```

On the first successful setup, Python dependencies are installed once into `/workspace/venvs/awal-runtime` and a dependency stamp is written under `/workspace`. Later Pods attached to the same Network Volume skip the Python install phase and start services from that persistent virtualenv.

The Hugging Face cache must stay at `/workspace/.cache/huggingface`; that is where the existing 32B model cache lives.

The bootstrap keeps the container alive with `RUNPOD_KEEPALIVE=1` after starting background services. Without this, the pod startup command can exit while RunPod still shows HTTP proxy entries, causing confusing `404` or `502` responses even though the services are gone.

If dependencies need to be rebuilt, start one Pod with:

```bash
RUNPOD_FORCE_INSTALL=1
```

Best production improvement is still a custom RunPod template/image with OS packages and Python dependencies baked in. The prepared-volume fast path is the practical intermediate step: it reduces repeated setup work without requiring a custom image registry yet.

The repo includes [Dockerfile.runtime](../deploy/runpod/Dockerfile.runtime) for that production image. The GitHub Actions workflow `.github/workflows/runpod-runtime-image.yml` builds and pushes:

```text
ghcr.io/l-ayim/awal-runpod-runtime:latest  # full: vLLM + Docling + embeddings
ghcr.io/l-ayim/awal-runpod-vllm:latest     # chat: vLLM only
```

For normal chat serving, prefer the vLLM-only image:

```powershell
flyctl secrets set `
  RUNPOD_IMAGE="ghcr.io/l-ayim/awal-runpod-vllm:latest" `
  RUNPOD_RUNTIME_MODE="vllm" `
  RUNPOD_PORTS="8000/http,22/tcp"
```

After the first workflow run, make the GHCR package public or configure RunPod registry credentials. When a custom image is used, the controller copies baked-in code from `/opt/awal` into `/workspace/Awal` before starting services.

For ingestion-heavy work, use the full runtime image or a separate ingestion runtime that wakes only for uploads and reprocessing:

```powershell
flyctl secrets set `
  RUNPOD_IMAGE="ghcr.io/l-ayim/awal-runpod-runtime:latest" `
  RUNPOD_RUNTIME_MODE="full" `
  AWAL_VENV_DIR="/opt/awal-venv" `
  RUNPOD_PORTS="8000/http,8010/http,8020/http,8030/http,22/tcp"
```

## Production Safeguards

Use these limits:

- minimum uptime window after wake: 30-60 minutes
- idle timeout: 20-30 minutes for testing, 1-2 hours for clients
- maximum cold-start wait: 15-30 minutes
- hard monthly GPU budget
- client usage caps and overage billing

For a premium client that needs instant responses 24/7, keep the Pod warm and price the plan as always-on capacity.
