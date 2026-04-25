# RunPod + Backblaze 32B Plan

## Purpose

This is the operating plan for moving Awal from the old manual Vast workflow to a repeatable 32B deployment with persistent cache and durable backups.

## Stack

- GitHub: Awal source code and deployment scripts
- Docker: repeatable service runtime
- Backblaze B2: permanent storage for models, LoRAs, checkpoints, outputs, and logs
- RunPod Network Volume: hot model cache and working disk mounted at `/workspace`
- RunPod GPU Pod: disposable compute
- vLLM: OpenAI-compatible generation server
- Docling, embeddings, rerank: supporting model services

## Recommended First 32B Setup

- Model: `Qwen/Qwen3-32B`
- GPU for serious testing: `RTX PRO 6000`
- Premium production GPU: `H200 SXM`
- Network volume: 400 GB minimum, 1 TB if storing multiple models
- Backblaze B2: 1 TB bucket to start
- Runtime path: `/workspace/Awal`
- Model/cache path: `/workspace/hf-cache`
- Outputs/checkpoints: `/workspace/outputs`, `/workspace/checkpoints`

## Operating Flow

1. Create the RunPod Network Volume in the chosen datacenter.
2. Launch a GPU Pod in the same datacenter and attach the volume.
3. Clone Awal to `/workspace/Awal`.
4. Start the RunPod runtime from `deploy/runpod`.
5. Point the app's existing OpenAI-compatible env vars at the RunPod endpoint.
6. Sync outputs and checkpoints to Backblaze B2.
7. Stop or terminate compute when idle.
8. Reattach the same volume to the next Pod and continue without rebuilding from scratch.

## Monthly Cost Reference

Approximate always-on H200 scenario:

- H200 SXM at `$3.99/hr`: `$2,872.80/month`
- RunPod Network Volume, 400 GB: about `$28/month`
- Backblaze B2, 1 TB: about `$6/month`
- Monitoring/logging/misc: about `$100-$300/month`
- Failure/operating buffer: about `$500-$1,000/month`

Expected all-in infrastructure range:

- always-on H200: about `$3,500-$4,300/month`
- optimized/idle-shutdown usage: materially lower, depending active GPU hours

## Client Pricing Reference

For a managed H200-equivalent Awal deployment:

- setup: `$50,000` one-time
- managed service: `$10,000/month`

The contract should include:

- one production deployment
- usage allowance or capacity limit
- monitoring and maintenance
- backup policy
- support-hour limit
- overage pricing for extra compute, fine-tuning, additional environments, or traffic spikes

## Why This Fixes The Old Vast Pain

The old workflow burned credits because each server was manually rebuilt and treated as the source of truth.

The new workflow makes compute disposable:

- `/workspace` survives on the Network Volume
- Backblaze B2 keeps the master backup
- Docker/bootstrap scripts rebuild services consistently
- the app only needs the OpenAI-compatible endpoint URL and API keys
