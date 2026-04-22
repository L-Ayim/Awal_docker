# Model Abstraction

## Purpose

This document defines how Awal should make models easy to switch.

The main rule is:

- business logic must not depend directly on a specific model id

## Architectural goal

Awal should allow independent replacement of:

- generation model
- embedding model
- reranker model

without rewriting:

- chat endpoints
- retrieval orchestration
- answer policy logic
- document ingestion

## Provider interfaces

Awal should define internal provider contracts.

### GenerationProvider

Responsibilities:

- accept bounded evidence input
- return normalized answer state and content

Example conceptual interface:

```ts
interface GenerationProvider {
  generateGroundedAnswer(
    input: GroundedAnswerRequest
  ): Promise<GroundedAnswerResult>;
}
```

### EmbeddingProvider

Responsibilities:

- accept text inputs
- return vectors and metadata

### RerankerProvider

Responsibilities:

- accept query-document pairs
- return normalized relevance scores

## Model registry

Awal should keep model choices in a registry, not in hardcoded constants.

### Generation model profile fields

- `profile_id`
- `provider_kind`
- `model_id`
- `api_base_url`
- `supports_structured_outputs`
- `supports_reasoning_toggle`
- `supports_long_context`
- `default_temperature`
- `default_max_output_tokens`
- `status`

### Embedding profile fields

- `profile_id`
- `provider_kind`
- `model_id`
- `dimension`
- `max_input_tokens`
- `status`

### Reranker profile fields

- `profile_id`
- `provider_kind`
- `model_id`
- `max_pair_tokens`
- `status`

## Capability flags

Route by capabilities, not by model names.

Good flags:

- `supports_structured_outputs`
- `supports_reasoning_toggle`
- `supports_long_context`
- `supports_chat_template`

Avoid logic like:

- "if model is Qwen do this"

## Normalized request contract

### GroundedAnswerRequest

- `question`
- `evidence_blocks`
- `citation_ids`
- `answer_mode`
- `refusal_required`
- `response_schema`

### GroundedAnswerResult

- `state`
- `content`
- `citation_refs`
- `provider_metadata`
- `raw_model_name`

## Why vLLM fits

The current `vLLM` docs show that its server exposes an OpenAI-compatible API. That makes it a strong default serving boundary because Awal can talk to a Vast-hosted generation box through one stable interface even as the underlying open-weight model changes.

## Switching procedure

When changing a model:

1. deploy the new model behind the same provider interface
2. register a new model profile
3. run the golden eval suite
4. compare against the current profile
5. promote only if the gates pass

## Versioning

Use explicit versioned profile ids, for example:

- `gen-qwen3-8b-v1`
- `gen-qwen3-14b-v1`
- `embed-bge-m3-v1`
- `rerank-bge-v2-m3-v1`

Every answer record should store the profile ids used.
