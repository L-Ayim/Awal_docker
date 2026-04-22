# Model and Serving Plan

## Purpose

This document records the recommended model stack and serving strategy for Awal.

## Recommended initial stack

### Generation

- `Qwen3-8B`

Reason:

- strong enough for grounded QA when paired with high-quality retrieval
- cheaper and simpler to host than larger models
- good starting fit for a 16 GB class GPU with careful serving choices
- better budget fit for early Vast.ai experimentation

### Embeddings

- `BAAI/bge-m3`

Reason:

- multilingual
- supports dense and sparse retrieval patterns
- useful for hybrid retrieval

### Reranking

- `BAAI/bge-reranker-v2-m3`

Reason:

- lightweight
- multilingual
- strong fit for query-passage reranking

## Why 8B is enough for v1

Awal is not trying to solve open-ended reasoning. It is solving:

- retrieve the right evidence
- answer from that evidence
- refuse when evidence is insufficient

If retrieval, reranking, and refusal policy are strong, an 8B model is enough for the initial product.

The first upgrade should be architectural quality, not parameter count:

- better chunking
- better reranking
- better answer validation
- better conflict detection

## Serving strategy

### Recommended initial hardware

- `1x 16 GB GPU` on Vast.ai

Ideal starting target:

- `RTX 5070 Ti` class offer

Fallback:

- `RTX 5060 Ti 16 GB`

Avoid for first iteration:

- multi-GPU complexity
- expensive 32 GB cards unless testing proves model size is the bottleneck

## Serving interface boundary

Use `vLLM` as the model-serving runtime and talk to it through its OpenAI-compatible HTTP API.

Why this matters:

- it keeps the Awal runtime decoupled from one model implementation
- it gives generation a stable client contract
- it makes future swaps to larger or different open models much easier

The current `vLLM` docs explicitly document an OpenAI-compatible server that supports chat completions and related APIs. That is the right serving boundary for Awal.

## Serving layout

### Primary recommendation

- serve `Qwen3-8B` with `vLLM`
- keep model serving isolated from public API
- let Fly.io call Vast.ai privately

### Bounded generation pattern

The generation server should not perform retrieval itself.

It should accept:

- question
- evidence blocks
- citation ids
- answer schema

It should return:

- answer text
- cited evidence ids referenced in the response
- optional structured confidence notes

## Vast.ai runtime notes

The current Vast.ai docs mean we should plan the inference box carefully:

- SSH and Jupyter runtypes replace the image entrypoint and expect your service startup in `onstart`
- port exposure must be declared explicitly through docker-style port mapping
- `jupyter_direct` is convenient for debugging and setup
- `ssh_direct` is cleaner once the service pattern is stable

That means the Awal inference instance should be configured as:

- a dedicated service container
- explicit port mapping for the `vLLM` API
- explicit `onstart` command to launch `vllm serve`
- environment-driven model selection

## Context-window guidance

The official `Qwen3-8B` card notes that the default configuration is sufficient for ordinary shorter-context use, and that YaRN should only be enabled when longer context is truly needed because it can degrade shorter-context performance.

For Awal:

- prefer retrieval over oversized context windows
- keep default shorter-context settings for ordinary document QA
- only enable longer context after targeted evaluation

## Model request contract

### Input

- normalized user question
- bounded top-k evidence blocks
- citation ids
- system instruction requiring refusal outside evidence

### Output

- answer state
- answer text
- citation references

## Model upgrade path

### Stay on 8B if

- grounded accuracy is acceptable
- refusal quality is acceptable
- latency and cost are good

### Move to 14B if

- retrieval is strong but synthesis quality is still weak
- conflict handling needs more nuanced comparison
- answers from strong evidence are still too brittle

### Do not move up just because

- larger models feel safer
- benchmarking looks nicer
- model quality is being used to cover weak retrieval

## Evaluation categories

Awal should evaluate model-serving quality using:

- grounded correctness
- citation correctness
- refusal precision
- refusal recall
- conflict surfacing
- latency
- token cost

## Anti-patterns

- using the model as the retrieval engine
- allowing the model to browse outside the corpus
- relying on a larger model instead of a stronger runtime
- mixing public API logic into the model server
