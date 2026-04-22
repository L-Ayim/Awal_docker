# API and MCP Contracts

## Purpose

This document defines the public API, MCP tool surface, internal service contracts, job names, and event names for Awal.

The goal is to make the implementation:

- easy to build
- easy to reason about
- reusable across document types
- stable enough to support future frontends and MCP clients

## Design rules

- use resource-oriented HTTP endpoints
- keep public actions narrow and predictable
- expose one main chat tool, not a toolbox explosion
- keep retrieval and policy orchestration server-side
- treat ingestion and indexing as jobs, not request-path work

## Public HTTP API

Base path:

- `/api/v1`

### Health and metadata

- `GET /api/v1/health`
  - liveness and dependency summary
- `GET /api/v1/runtime/profile`
  - product identity, version, enabled capabilities
- `GET /api/v1/runtime/capabilities`
  - supported formats, answer states, limits

### Session and auth

- `POST /api/v1/sessions`
  - create or resume a chat session
- `GET /api/v1/sessions/:sessionId`
  - fetch session metadata
- `POST /api/v1/sessions/:sessionId/archive`
  - archive a session

### Workspaces and collections

- `GET /api/v1/workspaces`
- `POST /api/v1/workspaces`
- `GET /api/v1/workspaces/:workspaceId`

- `GET /api/v1/workspaces/:workspaceId/collections`
- `POST /api/v1/workspaces/:workspaceId/collections`
- `GET /api/v1/workspaces/:workspaceId/collections/:collectionId`
- `PATCH /api/v1/workspaces/:workspaceId/collections/:collectionId`
- `DELETE /api/v1/workspaces/:workspaceId/collections/:collectionId`

### Documents

- `GET /api/v1/workspaces/:workspaceId/collections/:collectionId/documents`
- `POST /api/v1/workspaces/:workspaceId/collections/:collectionId/documents`
  - multipart upload or import request
- `GET /api/v1/documents/:documentId`
- `PATCH /api/v1/documents/:documentId`
- `DELETE /api/v1/documents/:documentId`

### Document revisions and ingest status

- `GET /api/v1/documents/:documentId/revisions`
- `POST /api/v1/documents/:documentId/revisions`
  - upload replacement file
- `GET /api/v1/document-revisions/:revisionId`
- `GET /api/v1/document-revisions/:revisionId/status`
- `POST /api/v1/document-revisions/:revisionId/reprocess`

### Chat

- `GET /api/v1/conversations`
- `POST /api/v1/conversations`
- `GET /api/v1/conversations/:conversationId`
- `GET /api/v1/conversations/:conversationId/messages`
- `POST /api/v1/conversations/:conversationId/messages`
  - add a user message and produce assistant answer

### Answers and citations

- `GET /api/v1/messages/:messageId/answer`
- `GET /api/v1/messages/:messageId/citations`
- `GET /api/v1/messages/:messageId/retrieval-trace`

### Admin and evaluation

- `GET /api/v1/admin/jobs`
- `GET /api/v1/admin/jobs/:jobId`
- `POST /api/v1/admin/evals/groundedness`
- `GET /api/v1/admin/audit-events`

## Primary request shapes

### Create document

`POST /api/v1/workspaces/:workspaceId/collections/:collectionId/documents`

Body variants:

- multipart upload with file
- JSON import request with remote source URL

Core fields:

- `title`
- `source_kind`
- `document_label`
- `ingest_mode`

### Add chat message

`POST /api/v1/conversations/:conversationId/messages`

Body:

```json
{
  "role": "user",
  "content": "What does the agreement say about termination notice?",
  "answer_mode": "grounded_only",
  "citation_mode": "required"
}
```

### Assistant answer shape

```json
{
  "answerId": "ans_123",
  "state": "grounded_answer",
  "content": "The agreement requires 30 days written notice before termination.",
  "citations": [
    {
      "citationId": "cit_1",
      "documentId": "doc_1",
      "documentTitle": "Service Agreement",
      "revisionId": "rev_7",
      "chunkId": "chk_91",
      "pageStart": 12,
      "pageEnd": 12,
      "lineStart": 4,
      "lineEnd": 9,
      "quotedText": "Either party may terminate this Agreement upon thirty (30) days prior written notice..."
    }
  ],
  "refusalReason": null
}
```

## MCP surface

The MCP surface should remain smaller than the internal HTTP API.

### Recommended initial tools

- `bootstrap_awal_session`
  - returns `sessionId`, active workspace/collection scope, and short session guidance
- `awal.ingest_document`
  - upload or register a document for ingestion
- `awal.list_documents`
  - list available docs in current scope
- `awal.ask`
  - ask a grounded question
- `awal.get_sources`
  - fetch citations and supporting spans for a given answer

### Why keep MCP small

The runtime, not the model, should orchestrate:

- retrieval
- reranking
- evidence thresholding
- refusal
- conflict detection

If you expose all those as model-selectable tools from the start, you push too much control back into the LLM loop.

## Internal services

These do not need to be separate deployables on day one, but they should be distinct code modules.

### Session service

Responsibilities:

- issue session ids
- bind sessions to workspace and collection scope
- persist conversation metadata

### Document service

Responsibilities:

- create document identities
- manage revisions
- expose status

### Ingestion service

Responsibilities:

- dispatch document parsing
- normalize Docling output
- create chunking inputs
- mark revision states

### Retrieval service

Responsibilities:

- query normalization
- lexical search
- vector search
- fusion
- reranking

### Answer policy service

Responsibilities:

- evaluate evidence threshold
- decide answer state
- enforce grounded-only mode
- detect conflicts

### Generation service client

Responsibilities:

- call Vast.ai `vLLM`
- send bounded prompt
- parse structured answer

## Job model

Longer-running work should use named jobs with explicit states.

### Job states

- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

### Job types

- `document.ingest`
- `document.reprocess`
- `document.embed`
- `collection.reindex`
- `eval.groundedness`

### Job payload examples

- `document.ingest`
  - `document_id`
  - `revision_id`
  - `workspace_id`
  - `collection_id`

- `collection.reindex`
  - `workspace_id`
  - `collection_id`
  - `reason`

## Event model

Use explicit event names in audit logs and async messaging.

### Document events

- `document.created`
- `document.revision_created`
- `document.ingest_started`
- `document.ingest_completed`
- `document.ingest_failed`
- `document.reprocess_requested`

### Retrieval and answer events

- `retrieval.started`
- `retrieval.completed`
- `retrieval.threshold_failed`
- `answer.grounded_generated`
- `answer.refused`
- `answer.conflict_detected`

### Ops events

- `job.queued`
- `job.started`
- `job.completed`
- `job.failed`

## Naming conventions

### HTTP resources

- plural nouns for top-level resources
- no verbs in collection names

Good:

- `/documents`
- `/conversations`
- `/messages`

Avoid:

- `/uploadDocument`
- `/runRag`

### Jobs and events

- lower-case dotted verbs and nouns
- stable names suitable for observability

Good:

- `document.ingest`
- `answer.refused`

## Recommended v1 implementation scope

If you want a tight first implementation, build these first:

- `GET /api/v1/health`
- `POST /api/v1/workspaces/:workspaceId/collections/:collectionId/documents`
- `GET /api/v1/document-revisions/:revisionId/status`
- `POST /api/v1/conversations`
- `POST /api/v1/conversations/:conversationId/messages`
- `GET /api/v1/messages/:messageId/citations`

And these MCP tools:

- `bootstrap_awal_session`
- `awal.ingest_document`
- `awal.ask`
- `awal.get_sources`
