from __future__ import annotations

import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import CrossEncoder


def _require_api_key(auth_header: str | None) -> None:
    expected = os.getenv("RERANK_API_KEY", "").strip()
    if not expected:
        return

    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    token = auth_header.removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(status_code=403, detail="Invalid bearer token.")


MODEL_NAME = os.getenv("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
MODEL = CrossEncoder(MODEL_NAME)


class RerankRequest(BaseModel):
    query: str = Field(min_length=1)
    documents: list[str] = Field(min_length=1)


app = FastAPI(title="Awal Rerank Service")


@app.get("/health")
def health():
    return {"ok": True, "service": "awal-rerank-service", "model": MODEL_NAME}


@app.post("/rerank")
def rerank(request: RerankRequest, authorization: str | None = Header(default=None)):
    _require_api_key(authorization)

    scores = MODEL.predict([(request.query, document) for document in request.documents])

    return {
        "model": MODEL_NAME,
        "data": [
            {
                "index": index,
                "score": float(score),
            }
            for index, score in enumerate(scores)
        ],
    }
