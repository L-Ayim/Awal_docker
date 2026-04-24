# Vast Deployment

This folder packages the non-Fly runtime pieces so a fresh GPU box can be brought up with predictable commands.

## Recommended Bring-Up

Use the compose stack first, not ad hoc tunnel commands.

```bash
cd deploy/vast
cp .env.runtime.example .env.runtime
docker compose --env-file .env.runtime -f docker-compose.gpu.yml up -d --build
```

This gives you one runtime definition for:

- `vLLM`
- `Docling`
- `embeddings`
- `rerank`

The services should then be exposed directly on the server's public IP and stable ports.

## Services

- `docling`
  - document extraction service with OCR support
  - exposes `POST /extract`
  - default internal port: `8010`
- `embeddings`
  - sentence-transformers embedding service
  - exposes `POST /embed`
  - default internal port: `8020`
- `rerank`
  - cross-encoder reranking service
  - exposes `POST /rerank`
  - default internal port: `8030`
- `vllm`
  - OpenAI-compatible generation server
  - default internal port: `8000`

## Docling Service

Build and run from the repo root:

```bash
export DOC_PROCESSOR_API_KEY=awal-docling-key
export DOCLING_DEVICE=cuda
bash deploy/vast/docling/build-and-run.sh
```

Manual build:

```bash
docker build -f deploy/vast/docling/Dockerfile -t awal-docling-service .
docker run -d --gpus all --name awal-docling-service -p 8010:8010 -e DOC_PROCESSOR_API_KEY=awal-docling-key -e DOCLING_DEVICE=cuda awal-docling-service
```

Health check:

```bash
curl http://127.0.0.1:8010/health
```

## Embedding Service

Build and run from the repo root:

```bash
export EMBEDDING_API_KEY=awal-embedding-key
export EMBEDDING_MODEL=BAAI/bge-m3
bash deploy/vast/embeddings/build-and-run.sh
```

Health check:

```bash
curl http://127.0.0.1:8020/health
```

## vLLM Generation

If you are not using Compose, install `vllm` on the box, then run:

```bash
API_KEY=awal-vast-key bash deploy/vast/vllm/run-qwen3-14b.sh
```

Smaller-model test profiles are available through the same launcher:

```bash
API_KEY=awal-vast-key bash deploy/vast/vllm/run-qwen3.sh 2b
API_KEY=awal-vast-key bash deploy/vast/vllm/run-qwen3.sh 4b
API_KEY=awal-vast-key bash deploy/vast/vllm/run-qwen3.sh 8b
API_KEY=awal-vast-key bash deploy/vast/vllm/run-qwen3.sh 14b
```

The `2b` profile uses `Qwen/Qwen3-1.7B`, which is the closest matching Qwen3 dense text model in that size range.

Wrapper scripts are also provided:

```bash
bash deploy/vast/vllm/run-qwen3-2b.sh
bash deploy/vast/vllm/run-qwen3-4b.sh
bash deploy/vast/vllm/run-qwen3-8b.sh
bash deploy/vast/vllm/run-qwen3-14b.sh
```

After switching the served model, update Fly so the app records and reports the model correctly:

```bash
flyctl secrets set VAST_LLM_MODEL="Qwen/Qwen3-8B"
```

Health check:

```bash
curl http://127.0.0.1:8000/v1/models -H "Authorization: Bearer awal-vast-key"
```

## Rerank Service

Build and run from the repo root:

```bash
export RERANK_API_KEY=awal-rerank-key
export RERANK_MODEL=BAAI/bge-reranker-v2-m3
bash deploy/vast/rerank/build-and-run.sh
```

Health check:

```bash
curl http://127.0.0.1:8030/health
```

## Fly Secrets

After the Vast services are reachable from outside the box, set:

```powershell
flyctl secrets set `
  DOC_PROCESSOR_BASE_URL="http://<vast-ip>:<docling-port>" `
  DOC_PROCESSOR_API_KEY="awal-docling-key" `
  EMBEDDING_BASE_URL="http://<vast-ip>:<embedding-port>" `
  EMBEDDING_API_KEY="awal-embedding-key" `
  RERANK_BASE_URL="http://<vast-ip>:<rerank-port>" `
  RERANK_API_KEY="awal-rerank-key" `
  VAST_OPENAI_BASE_URL="http://<vast-ip>:<vllm-port>/v1" `
  VAST_OPENAI_API_KEY="awal-vast-key"
```

## Important

- Expose direct public ports for `8000`, `8010`, `8020`, and `8030`.
- Do not treat temporary Cloudflare tunnels as the normal production path.
- The Docling container should be rebuilt on the GPU host after OCR/runtime changes.
- If the box is replaced, the same compose file and env file should be reusable.
- Long-term, durable object storage should replace machine-local `/tmp` upload paths.
