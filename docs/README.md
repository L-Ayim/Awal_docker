# Awal Documentation

This folder contains the architecture and implementation planning set for Awal.

## Reading Order

1. [Fresh Server And Database Setup](fresh-server-setup.md)
2. [Architecture](architecture.md)
3. [Deployment Topology](deployment-topology.md)
4. [Data Model](data-model.md)
5. [Runtime Flows](runtime-flows.md)
6. [API and MCP Contracts](api-and-contracts.md)
7. [Docling Ingestion Plan](docling-ingestion.md)
8. [Evaluation Strategy](evaluation-strategy.md)
9. [Model Abstraction](model-abstraction.md)
10. [Model and Serving Plan](model-and-serving.md)
11. [Frontend](frontend.md)
12. [Operations And Rebuild](operations-and-rebuild.md)
13. [Diagrams](diagrams/README.md)

## Document Set

- `fresh-server-setup.md`
  - new server, new database, Vast runtime, Fly secrets, deployment, and ingestion checklist
- `architecture.md`
  - overall system goals, boundaries, responsibilities, and product shape
- `deployment-topology.md`
  - how Fly.io, Neon, object storage, and Vast.ai fit together
- `data-model.md`
  - entity model, tables, and lifecycle notes
- `runtime-flows.md`
  - ingestion, retrieval, answer generation, verification, refusal, and operational flows
- `api-and-contracts.md`
  - endpoint names, request contracts, and job/event naming
- `docling-ingestion.md`
  - document parsing strategy, Docling fit, supported formats, and fallback rules
- `evaluation-strategy.md`
  - quality metrics, groundedness suites, regression workflow, and promotion gates
- `model-abstraction.md`
  - provider interfaces, model profiles, capability flags, and switching procedure
- `model-and-serving.md`
  - model choices, GPU strategy, serving assumptions, and upgrade path
- `frontend.md`
  - product UI notes
- `operations-and-rebuild.md`
  - repeatable GPU-host bring-up, Fly secret wiring, and post-rebuild checks
- `diagrams/*`
  - Mermaid source diagrams for architecture, sequences, and ERD
