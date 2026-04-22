# Awal Documentation

This folder contains the architecture and implementation planning set for Awal.

## Reading order

1. [Architecture](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\architecture.md)
2. [Deployment Topology](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\deployment-topology.md)
3. [Data Model](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\data-model.md)
4. [Runtime Flows](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\runtime-flows.md)
5. [API and MCP Contracts](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\api-and-contracts.md)
6. [Docling Ingestion Plan](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\docling-ingestion.md)
7. [Evaluation Strategy](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\evaluation-strategy.md)
8. [Model Abstraction](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\model-abstraction.md)
9. [Model and Serving Plan](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\model-and-serving.md)
10. [Frontend](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\frontend.md)
11. [Operations And Rebuild](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\operations-and-rebuild.md)
12. [Diagrams](C:\Users\Lawrence.Ayim\source\side_repos\Johnson\Awal\docs\diagrams\README.md)

## Document set

- `architecture.md`
  - overall system goals, boundaries, responsibilities, and product shape
- `deployment-topology.md`
  - how Fly.io, Neon, and Vast.ai fit together
- `data-model.md`
  - entity model, tables, and lifecycle notes
- `runtime-flows.md`
  - ingestion, retrieval, answer generation, refusal, and operational flows
- `api-and-contracts.md`
  - endpoint names, MCP tool names, request contracts, and job/event naming
- `docling-ingestion.md`
  - document parsing strategy, Docling fit, supported formats, and fallback rules
- `evaluation-strategy.md`
  - quality metrics, groundedness suites, regression workflow, and promotion gates
- `model-abstraction.md`
  - provider interfaces, model profiles, capability flags, and switching procedure
- `model-and-serving.md`
  - model choices, GPU strategy, serving assumptions, and upgrade path
- `frontend.md`
  - minimal product UI for the initial release
- `operations-and-rebuild.md`
  - repeatable GPU-host bring-up, Fly secret wiring, and post-rebuild checks
- `diagrams/*`
  - Mermaid source diagrams for architecture, sequences, and ERD
