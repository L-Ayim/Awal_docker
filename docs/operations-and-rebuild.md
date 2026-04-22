# Operations And Rebuild

This is the deployment runbook for bringing Awal up on a fresh server without repeating the debugging loop.

## Target Topology

- `Fly.io`
  - Next.js app runtime
  - session and API layer
  - retrieval orchestration
- `Neon`
  - primary Postgres database
- `GPU host`
  - `vLLM` on `8000`
  - `Docling` on `8010`
  - `Embeddings` on `8020`
  - `Rerank` on `8030`

## Required Principle

Do not depend on temporary tunnel URLs as the normal production path.

Use direct public ports on the GPU host and point Fly at those ports.

## Fresh Server Bring-Up

1. Install Docker Engine with Compose and NVIDIA Container Toolkit.
2. Clone the repo to the server.
3. Copy [deploy/vast/.env.runtime.example](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\deploy\vast\.env.runtime.example) to `deploy/vast/.env.runtime`.
4. Adjust secrets, model name, and GPU settings in that file.
5. Start the runtime stack:

```bash
cd /workspace/Awal/deploy/vast
docker compose --env-file .env.runtime -f docker-compose.gpu.yml up -d --build
```

6. Verify the services:

```bash
curl http://127.0.0.1:8000/v1/models -H "Authorization: Bearer awal-vast-key"
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8020/health
curl http://127.0.0.1:8030/health
```

7. Expose the same ports publicly on the host:

- `8000/tcp`
- `8010/tcp`
- `8020/tcp`
- `8030/tcp`

8. Update Fly secrets:

```powershell
flyctl secrets set `
  DOC_PROCESSOR_BASE_URL="http://<gpu-host-ip>:8010" `
  DOC_PROCESSOR_API_KEY="awal-docling-key" `
  EMBEDDING_BASE_URL="http://<gpu-host-ip>:8020" `
  EMBEDDING_API_KEY="awal-embedding-key" `
  RERANK_BASE_URL="http://<gpu-host-ip>:8030" `
  RERANK_API_KEY="awal-rerank-key" `
  VAST_OPENAI_BASE_URL="http://<gpu-host-ip>:8000/v1" `
  VAST_OPENAI_API_KEY="awal-vast-key" `
  VAST_LLM_MODEL="Qwen/Qwen3-14B" `
  -a awal-app
```

9. Deploy or restart Fly.

## Expected Chat Path

1. User message reaches Fly.
2. Fly retrieves and reranks evidence candidates.
3. Fly sends question plus evidence candidates to `vLLM`.
4. The model returns structured output:
   - response kind
   - lead text
   - bullets
   - selected evidence ids
5. Fly renders canonical citations from stored span metadata.
6. Fly stores only the evidence actually selected by the model.

## What To Verify After Rebuild

- conversational prompts do not leak into retrieval junk
- grounded prompts produce direct answers, not fallback snippet dumps
- citations use document title and page or line labels
- `AnswerCitation` rows reflect model-selected evidence only
- OCR jobs can be run without taking down the whole runtime

## Current Known Operational Risks

- `vLLM`, embeddings, rerank, and Docling share one GPU box, so VRAM pressure still matters
- `Docling` should usually be stopped when not actively reprocessing OCR-heavy files
- the Fly image still emits an OpenSSL warning from Prisma during build; it does not currently block deploys, but it should be cleaned up in the Docker image later
