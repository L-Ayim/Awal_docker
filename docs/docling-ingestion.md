# Docling Ingestion Plan

## Recommendation

Yes, Docling is a good fit for Awal.

It should be the primary document conversion and structure-extraction layer for `v1`, with Awal treating Docling output as normalized source material rather than using raw converted Markdown as the only truth artifact.

## Why Docling fits

Docling is useful here because it already supports a broad set of input types and converts them into a unified document representation.

Officially documented supported input formats include:

- `PDF`
- `DOCX`
- `XLSX`
- `PPTX`
- `Markdown`
- `AsciiDoc`
- `LaTeX`
- `HTML`
- `CSV`
- image formats such as `PNG`, `JPEG`, `TIFF`, `BMP`, `WEBP`
- audio formats such as `WAV`, `MP3`, `M4A`, `AAC`, `OGG`, `FLAC`
- video formats such as `MP4`, `AVI`, `MOV`
- `WebVTT`
- schema-specific XML variants such as `USPTO XML`, `JATS XML`, and `XBRL XML`

Sources:

- [Supported formats](https://docling-project.github.io/docling/usage/supported_formats/)
- [Docling GitHub README](https://github.com/docling-project/docling)

That breadth is useful because Awal wants to be reusable across many document shapes, not just PDFs.

## Important constraint

Docling helps a lot, but it should not become the entire Awal document model.

Awal should store:

- original file identity
- revision record
- normalized Docling output
- Awal-specific sections, chunks, spans, and retrieval metadata

That way:

- Docling is replaceable if needed
- retrieval logic stays under Awal's control
- citation spans remain stable

## Ingestion architecture

### Stage 1: File intake

Awal receives:

- uploaded file
- optional source URL
- workspace and collection scope

Awal creates:

- `Document`
- `DocumentRevision`
- `document.ingest` job

### Stage 2: Conversion with Docling

Worker invokes Docling and obtains:

- unified Docling document representation
- extracted structure
- markdown or JSON export for debugging/review if desired

Preferred internal preservation:

- keep Docling JSON or equivalent normalized structure
- optionally also keep Markdown export for operator readability

### Stage 3: Awal normalization

Awal converts Docling output into its own internal structure:

- document sections
- chunk candidates
- page and line references where available
- table-aware chunk units where needed

### Stage 4: Retrieval preparation

Awal then:

- creates normalized chunks
- generates embeddings
- stores lexical search text
- marks revision status as ready

## How to use Docling well

### Good use

- parsing many file types into one common structure
- OCR-aware extraction for scanned inputs
- table-aware parsing
- preserving section hierarchy

### Bad use

- dumping full document Markdown directly into the vector index
- skipping Awal chunking and span normalization
- relying on Docling output alone for final citation references

## Preferred outputs from Docling

Awal should retain at least two artifacts:

- `normalized document JSON`
- `operator-readable export`, usually Markdown

The JSON-like representation is for the runtime.
The Markdown is for debugging, QA, and internal review.

## Format handling policy

### Tier 1 formats for v1

These should be first-class and well-supported:

- PDF
- DOCX
- HTML
- Markdown
- PPTX
- XLSX
- images

### Tier 2 formats for later hardening

- LaTeX
- AsciiDoc
- CSV-heavy workflows
- schema-specific XML
- audio/video transcription inputs

These can be accepted later after the first retrieval pipeline is stable.

## OCR and scanned documents

Docling supports OCR-oriented workflows, but OCR quality still varies by source quality and engine setup.

For Awal:

- support OCR-based ingest
- mark OCR confidence or extraction quality when possible
- surface low-confidence ingestion in admin views

Do not treat OCR-derived text as equally trustworthy without marking its provenance and quality.

## GPU strategy for Docling

Docling documents official GPU guidance for both its standard and VLM pipelines.

Important details from the official docs:

- GPU acceleration can be configured in the standard pipeline
- OCR engine GPU behavior depends on third-party OCR backends
- for the VLM pipeline, Docling recommends using a local OpenAI-compatible inference server such as `vLLM`

Source:

- [Docling GPU support](https://docling-project.github.io/docling/usage/gpu/)

For Awal, the practical recommendation is:

- run Docling ingestion in the worker path
- start on CPU or modest GPU usage
- only move Docling parsing to a dedicated GPU-backed ingestion service if throughput demands it

Do not couple the initial answer-generation GPU directly to ingestion unless needed.

## Proposed internal contract

### Input to ingestion worker

```json
{
  "documentId": "doc_123",
  "revisionId": "rev_5",
  "workspaceId": "ws_1",
  "collectionId": "col_8",
  "sourceUri": "s3://...",
  "mimeType": "application/pdf"
}
```

### Normalized output from Docling stage

```json
{
  "status": "success",
  "formatFamily": "pdf",
  "doclingArtifactUri": "s3://.../docling.json",
  "markdownArtifactUri": "s3://.../document.md",
  "sectionCount": 42,
  "pageCount": 18
}
```

### Output from Awal normalization stage

```json
{
  "status": "success",
  "sectionCount": 42,
  "chunkCount": 196,
  "citationSpanCount": 196,
  "embeddingStatus": "queued"
}
```

## Fallback strategy

If Docling fails:

- do not silently create an empty document
- mark the revision as failed
- store error reason
- allow operator reprocess

If Docling partially succeeds:

- mark revision as `partial_success` or equivalent internal state
- store whatever structural signal is available
- prevent chat usage until minimum readiness threshold is met

## Final recommendation

Use Docling as the primary parsing layer, yes.

But the system should still be:

- `Docling for conversion`
- `Awal for normalization`
- `Neon for truth and retrieval metadata`
- `Fly for policy and orchestration`

That is the cleanest way to stay reusable across document types without letting the parser dictate the entire runtime design.
