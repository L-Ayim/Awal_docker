FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PORT=8030

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY requirements-rerank-service.txt ./requirements-rerank-service.txt
COPY scripts/rerank_service.py ./scripts/rerank_service.py

RUN python -m pip install --upgrade pip \
  && python -m pip install -r requirements-rerank-service.txt

EXPOSE 8030

CMD ["uvicorn", "scripts.rerank_service:app", "--host", "0.0.0.0", "--port", "8030", "--app-dir", "/app"]
