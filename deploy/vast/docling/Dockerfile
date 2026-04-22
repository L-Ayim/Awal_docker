FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PORT=8010
ENV DOCLING_DEVICE=cuda

ARG TORCH_WHEEL_INDEX_URL=https://download.pytorch.org/whl/cu128

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements-docling-service.txt ./requirements-docling-service.txt
COPY scripts/docling_service.py ./scripts/docling_service.py

RUN python -m pip install --upgrade pip \
  && python -m pip install -r requirements-docling-service.txt --extra-index-url ${TORCH_WHEEL_INDEX_URL}

EXPOSE 8010

CMD ["uvicorn", "scripts.docling_service:app", "--host", "0.0.0.0", "--port", "8010", "--app-dir", "/app"]
