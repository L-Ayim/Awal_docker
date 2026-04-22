from __future__ import annotations

import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer


def _require_api_key(auth_header: str | None) -> None:
    expected = os.getenv("EMBEDDING_API_KEY", "").strip()
    if not expected:
        return

    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    token = auth_header.removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(status_code=403, detail="Invalid bearer token.")


MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
MODEL = SentenceTransformer(MODEL_NAME)


class EmbeddingRequest(BaseModel):
    inputs: list[str] = Field(min_length=1)


app = FastAPI(title="Awal Embedding Service")


@app.get("/health")
def health():
    return {"ok": True, "service": "awal-embedding-service", "model": MODEL_NAME}


@app.post("/embed")
def embed(request: EmbeddingRequest, authorization: str | None = Header(default=None)):
    _require_api_key(authorization)

    vectors = MODEL.encode(
        request.inputs,
        normalize_embeddings=True,
        convert_to_numpy=True,
    )

    return {
        "model": MODEL_NAME,
        "dimensions": int(vectors.shape[1]),
        "data": [
            {
                "index": index,
                "embedding": vector.tolist(),
            }
            for index, vector in enumerate(vectors)
        ],
    }
