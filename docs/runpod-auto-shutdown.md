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

## MVP Automation

First version:

```text
manual wake
manual sleep
```

Second version:

```text
Awal backend records last model request time
cron job checks every 5 minutes
if idle for 30 minutes, sync and terminate
```

Third version:

```text
new user request wakes Pod automatically
request waits or shows "model warming up"
once /v1/models is healthy, request continues
```

## Production Safeguards

Use these limits:

- minimum uptime window after wake: 30-60 minutes
- idle timeout: 20-30 minutes for testing, 1-2 hours for clients
- maximum cold-start wait: 15-30 minutes
- hard monthly GPU budget
- client usage caps and overage billing

For a premium client that needs instant responses 24/7, keep the Pod warm and price the plan as always-on capacity.
