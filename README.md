# Awal

Awal is a document-grounded chatbot designed to answer only from documents that have been explicitly ingested into its workspace.

The product goal is narrow on purpose:

- ingest user-provided documents
- retrieve exact evidence from those documents
- answer only from retrieved evidence
- refuse when the evidence is insufficient
- return citations and provenance with every grounded answer

Awal is not intended to be a general assistant. Its runtime should prefer explicit refusal over unsupported generation.

## Core stack

- `Fly.io`
  - MCP/API runtime
  - auth and session control
  - retrieval orchestration
  - answer policy enforcement
- `Neon Postgres`
  - document registry
  - chunk and span storage
  - retrieval metadata
  - conversations and audit records
- `Vast.ai`
  - model inference
  - primary generation service via `vLLM`
- `Open-source models`
  - generation: `Qwen3-8B`
  - embeddings: `BAAI/bge-m3`
  - reranking: `BAAI/bge-reranker-v2-m3`

## Documentation

- [Documentation Index](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\README.md)
- [Architecture](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\architecture.md)
- [Runtime Flows](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\runtime-flows.md)
- [Data Model](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\data-model.md)
- [Deployment Topology](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\deployment-topology.md)
- [API and MCP Contracts](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\api-and-contracts.md)
- [Docling Ingestion Plan](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\docling-ingestion.md)
- [Evaluation Strategy](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\evaluation-strategy.md)
- [Model Abstraction](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\model-abstraction.md)
- [Model and Serving Plan](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\model-and-serving.md)
- [Frontend](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\frontend.md)
- [Diagrams](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\diagrams\README.md)
- [Vast Deployment Assets](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\deploy\vast\README.md)

## Architectural stance

Awal follows the same core architectural doctrine already present in the wider portfolio:

- intelligence reasons
- the runtime governs
- computing executes

In practical terms:

- the model does not decide what documents it may use
- the runtime decides what evidence is allowed
- the answer must be traceable to retrieved spans
- the system should never silently degrade into best-guess behavior

## Remote document processing

Awal's ingestion path is moving to a remote `Docling` processor on Vast so Fly stays focused on API orchestration.

- lightweight text formats can still be normalized directly
- document-heavy formats should go through the remote Docling bridge
- generation also stays on Vast via `vLLM`
- the app/runtime boundary stays stable even when Vast boxes are replaced

The repo includes:

- [scripts/docling_service.py](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\scripts\docling_service.py)
- [scripts/embedding_service.py](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\scripts\embedding_service.py)
- [scripts/rerank_service.py](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\scripts\rerank_service.py)
- [requirements-docling-service.txt](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\requirements-docling-service.txt)
- [requirements-embedding-service.txt](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\requirements-embedding-service.txt)
- [requirements-rerank-service.txt](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\requirements-rerank-service.txt)
- [deploy/vast/docling/Dockerfile](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\deploy\vast\docling\Dockerfile)
- [deploy/vast/embeddings/Dockerfile](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\deploy\vast\embeddings\Dockerfile)
- [deploy/vast/rerank/Dockerfile](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\deploy\vast\rerank\Dockerfile)
- [deploy/vast/vllm/run-qwen3-8b.sh](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\deploy\vast\vllm\run-qwen3-8b.sh)
