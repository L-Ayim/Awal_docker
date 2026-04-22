FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PORT=8020

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY requirements-embedding-service.txt ./requirements-embedding-service.txt
COPY scripts/embedding_service.py ./scripts/embedding_service.py

RUN python -m pip install --upgrade pip \
  && python -m pip install -r requirements-embedding-service.txt

EXPOSE 8020

CMD ["uvicorn", "scripts.embedding_service:app", "--host", "0.0.0.0", "--port", "8020", "--app-dir", "/app"]
