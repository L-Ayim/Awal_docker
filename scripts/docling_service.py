from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse


def _require_api_key(auth_header: str | None) -> None:
    expected = os.getenv("DOC_PROCESSOR_API_KEY", "").strip()
    if not expected:
        return

    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    token = auth_header.removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(status_code=403, detail="Invalid bearer token.")


def _make_converter(ocr_mode: str):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        AcceleratorDevice,
        AcceleratorOptions,
        PdfPipelineOptions,
        TableStructureOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pdf_options = PdfPipelineOptions()
    pdf_options.do_ocr = ocr_mode == "force-ocr"
    pdf_options.do_table_structure = True
    pdf_options.table_structure_options = TableStructureOptions(do_cell_matching=True)
    pdf_options.accelerator_options = AcceleratorOptions(
        num_threads=max(1, os.cpu_count() or 1),
        device=AcceleratorDevice.CPU,
    )

    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=pdf_options,
            )
        }
    )


def _count_pages(document) -> int | None:
    pages = getattr(document, "pages", None)
    if pages is None:
        return None

    try:
        return len(pages)
    except TypeError:
        return None


def _convert_pdf(source_path: Path, title: str, ocr_mode: str) -> dict:
    converter = _make_converter(ocr_mode)
    result = converter.convert(str(source_path))
    document = result.document
    markdown = document.export_to_markdown().strip()

    return {
        "title": title or source_path.stem,
        "markdown": markdown,
        "pageCount": _count_pages(document),
        "qualityNotes": f"Converted with remote Docling ({ocr_mode}).",
    }


app = FastAPI(title="Awal Docling Service")


@app.get("/health")
def health():
    return {"ok": True, "service": "awal-docling-service"}


@app.post("/extract")
async def extract(
    file: UploadFile = File(...),
    title: str = Form(""),
    ocr_mode: str = Form("text-first"),
    authorization: str | None = Header(default=None),
):
    _require_api_key(authorization)

    suffix = Path(file.filename or "document.bin").suffix or ".bin"
    temp_path: Path | None = None

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_path = Path(temp_file.name)

        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            temp_file.write(chunk)

    try:
        payload = _convert_pdf(
            temp_path,
            title.strip() or (file.filename or "document"),
            ocr_mode,
        )
        return JSONResponse(payload)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass
