# Awal

Awal is a general-purpose document-grounded chatbot. It answers from documents that have been explicitly ingested into its workspace, returns citations/provenance, and refuses when retrieved evidence is insufficient.

The product goal is intentionally source-grounded:

- ingest user-provided documents
- parse and normalize source material
- build chunks, citation spans, index cards, and embeddings
- retrieve exact evidence from those documents
- generate answers only from retrieved evidence
- verify drafted claims against evidence before storing citations
- expose references and previews in the UI

Awal is not a general web-knowledge assistant. Its runtime should prefer explicit refusal over unsupported generation.

## Core Stack

- `Fly.io`
  - Next.js app/API runtime
  - retrieval orchestration
  - answer policy and verification enforcement
- `Neon Postgres`
  - workspaces, collections, documents, revisions
  - chunks, citation spans, index cards, embeddings
  - conversations, retrieval traces, answer citations
- `Backblaze B2/S3-compatible storage`
  - durable upload storage when configured
  - local file storage fallback for development
- `RunPod` / `Vast.ai`
  - model inference and document-processing services
  - RunPod Network Volume for hot model cache in the 32B deployment
- `Open-source models`
  - generation: `Qwen/Qwen3-32B` for premium deployment, `Qwen/Qwen3-14B` as fallback
  - embeddings: `BAAI/bge-m3`
  - optional reranking: `BAAI/bge-reranker-v2-m3`

## Quick Start

```bash
git clone https://github.com/L-Ayim/Awal_docker.git Awal
cd Awal
npm ci
cp .env.example .env
npm run setup:fresh-db
npm run build
npm run start
```

For a full new server/new database rebuild, follow [Fresh Server And Database Setup](docs/fresh-server-setup.md).

## Documentation

- [Documentation Index](docs/README.md)
- [Fresh Server And Database Setup](docs/fresh-server-setup.md)
- [Architecture](docs/architecture.md)
- [Runtime Flows](docs/runtime-flows.md)
- [Data Model](docs/data-model.md)
- [Deployment Topology](docs/deployment-topology.md)
- [API and MCP Contracts](docs/api-and-contracts.md)
- [Docling Ingestion Plan](docs/docling-ingestion.md)
- [Evaluation Strategy](docs/evaluation-strategy.md)
- [Model Abstraction](docs/model-abstraction.md)
- [Model and Serving Plan](docs/model-and-serving.md)
- [Frontend](docs/frontend.md)
- [Operations And Rebuild](docs/operations-and-rebuild.md)
- [RunPod + Backblaze 32B Plan](docs/runpod-backblaze-32b-plan.md)
- [RunPod Auto Shutdown](docs/runpod-auto-shutdown.md)
- [Diagrams](docs/diagrams/README.md)
- [Vast Deployment Assets](deploy/vast/README.md)
- [RunPod Deployment Assets](deploy/runpod/README.md)

## Architectural Stance

Awal follows the same core architectural doctrine already present in the wider portfolio:

- intelligence reasons
- the runtime governs
- computing executes

In practical terms:

- the model does not decide what documents it may use
- the runtime decides what evidence is allowed
- retrieval selects candidate evidence
- generation drafts an answer from candidates
- verification checks the draft against source evidence
- citations are stored only from selected evidence
- the system should never silently degrade into best-guess behavior

## Remote Document Processing

Awal's ingestion path can use a remote `Docling` processor on Vast so Fly stays focused on API orchestration.

- lightweight text formats can still be normalized directly
- document-heavy formats should go through the remote Docling bridge
- generation stays on Vast via `vLLM`
- embedding and optional rerank services stay on Vast
- the app/runtime boundary stays stable when Vast boxes are replaced

The repo includes:

- [scripts/docling_service.py](scripts/docling_service.py)
- [scripts/embedding_service.py](scripts/embedding_service.py)
- [scripts/rerank_service.py](scripts/rerank_service.py)
- [requirements-docling-service.txt](requirements-docling-service.txt)
- [requirements-embedding-service.txt](requirements-embedding-service.txt)
- [requirements-rerank-service.txt](requirements-rerank-service.txt)
- [deploy/vast/docling/Dockerfile](deploy/vast/docling/Dockerfile)
- [deploy/vast/embeddings/Dockerfile](deploy/vast/embeddings/Dockerfile)
- [deploy/vast/rerank/Dockerfile](deploy/vast/rerank/Dockerfile)
- [deploy/vast/vllm/run-qwen3-14b.sh](deploy/vast/vllm/run-qwen3-14b.sh)
