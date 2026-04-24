# Fresh Server And Database Setup

This runbook is the shortest path for rebuilding Awal on a new Fly app, new Neon database, and new Vast GPU box.

## 1. Clone And Install

```bash
git clone https://github.com/L-Ayim/Awal_docker.git Awal
cd Awal
npm ci
cp .env.example .env
```

Fill `.env` with the new database URL, object storage credentials, and remote service URLs.

## 2. Create Or Reset The Database Schema

For a new empty database:

```bash
npm run setup:fresh-db
```

This command:

- loads `.env` and `.env.local` if present
- validates `DATABASE_URL` and `DIRECT_URL`
- runs `prisma generate`
- runs `prisma db push`
- creates the default Awal workspace and collection

Use this for new Neon databases. For a production database that already has data, do not run destructive SQL manually; use Prisma migrations or a planned migration path.

## 3. Start Vast Runtime Services

On the Vast GPU box:

```bash
cd /workspace
git clone https://github.com/L-Ayim/Awal_docker.git Awal
cd Awal/deploy/vast
cp .env.runtime.example .env.runtime
docker compose --env-file .env.runtime -f docker-compose.gpu.yml up -d --build
```

Expected local service ports:

- vLLM/Qwen: `http://127.0.0.1:8000/v1`
- Docling: `http://127.0.0.1:8010`
- embeddings: `http://127.0.0.1:8020`
- rerank: `http://127.0.0.1:8030`

If Vast tunnels are used, create tunnels for ports `8000`, `8010`, `8020`, and optionally `8030`.

To compare smaller generators, use `deploy/vast/vllm/run-qwen3.sh` with `2b`, `4b`, `8b`, or `14b`, then update `VAST_LLM_MODEL` on Fly to match. See [Model Size Evaluation](model-size-eval.md).

## 4. Configure Fly Secrets

```bash
flyctl secrets set \
  DATABASE_URL="postgresql://..." \
  DIRECT_URL="postgresql://..." \
  AWS_ACCESS_KEY_ID="..." \
  AWS_SECRET_ACCESS_KEY="..." \
  AWS_ENDPOINT_URL_S3="https://fly.storage.tigris.dev" \
  AWS_REGION="auto" \
  BUCKET_NAME="..." \
  VAST_OPENAI_BASE_URL="https://<vllm-tunnel-or-host>/v1" \
  VAST_OPENAI_API_KEY="awal-vast-key" \
  VAST_LLM_MODEL="Qwen/Qwen3-14B" \
  EMBEDDING_BASE_URL="https://<embedding-tunnel-or-host>" \
  EMBEDDING_API_KEY="awal-embedding-key" \
  VAST_EMBEDDING_MODEL="BAAI/bge-m3" \
  DOC_PROCESSOR_BASE_URL="https://<docling-tunnel-or-host>" \
  DOC_PROCESSOR_API_KEY="awal-docling-key"
```

Optional rerank:

```bash
flyctl secrets set \
  RERANK_BASE_URL="https://<rerank-tunnel-or-host>" \
  RERANK_API_KEY="awal-rerank-key" \
  VAST_RERANK_MODEL="BAAI/bge-reranker-v2-m3"
```

## 5. Deploy Fly

```bash
flyctl deploy
curl https://awal-app.fly.dev/api/health
```

Health should report:

- `database: "reachable"`
- `generationProviderConfigured: true`
- `embeddingProviderConfigured: true`
- `llmModel: "Qwen/Qwen3-14B"`
- `embeddingModel: "BAAI/bge-m3"`

## 6. Ingest Documents

Use the UI upload, or batch import a folder from a machine that has the app reachable:

```bash
npm run import:folder -- /path/to/docs --process
```

Useful flags:

- `--clear`: removes existing documents from the default collection before importing
- `--process`: calls the app worker endpoint until the ingestion queue is empty

After ingestion, check:

```bash
curl https://awal-app.fly.dev/api/health
```

Then ask a question in the app and verify that references appear.

## 7. What Is Reproducible

The repository now includes:

- app Dockerfile for Fly
- Vast Docker Compose stack for vLLM, Docling, embeddings, and rerank
- Prisma schema for database creation
- `setup:fresh-db` script for new databases
- batch folder import and ingestion processing script
- environment examples for app and Vast runtime
