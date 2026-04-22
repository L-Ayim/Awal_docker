from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def _make_converter():
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        AcceleratorDevice,
        AcceleratorOptions,
        PdfPipelineOptions,
        TableStructureOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pdf_options = PdfPipelineOptions()
    pdf_options.do_ocr = True
    pdf_options.do_table_structure = True
    pdf_options.table_structure_options = TableStructureOptions(
        do_cell_matching=True
    )
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--title", required=False, default="")
    args = parser.parse_args()

    source_path = Path(args.source)

    if not source_path.exists():
        raise FileNotFoundError(f"Source file does not exist: {source_path}")

    converter = _make_converter()
    result = converter.convert(str(source_path))
    document = result.document
    markdown = document.export_to_markdown().strip()
    title = args.title.strip() or source_path.stem
    page_count = _count_pages(document)

    payload = {
        "title": title,
        "markdown": markdown,
        "pageCount": page_count,
        "qualityNotes": "Converted with Docling CPU pipeline.",
    }

    sys.stdout.write(json.dumps(payload))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        sys.stderr.write(str(error))
        raise
