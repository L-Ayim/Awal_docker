from __future__ import annotations

import os

import torch
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoModel, AutoTokenizer


def _require_api_key(auth_header: str | None) -> None:
    expected = os.getenv("EMBEDDING_API_KEY", "").strip()
    if not expected:
        return

    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    token = auth_header.removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(status_code=403, detail="Invalid bearer token.")


MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
TOKENIZER = AutoTokenizer.from_pretrained(MODEL_NAME)
MODEL = AutoModel.from_pretrained(MODEL_NAME).to(DEVICE)
MODEL.eval()


class EmbeddingRequest(BaseModel):
    inputs: list[str] = Field(min_length=1)


def _mean_pool(last_hidden_state: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    mask = attention_mask.unsqueeze(-1).to(last_hidden_state.dtype)
    summed = (last_hidden_state * mask).sum(dim=1)
    counts = mask.sum(dim=1).clamp(min=1e-9)
    return summed / counts


def _embed(inputs: list[str]) -> torch.Tensor:
    encoded = TOKENIZER(
        inputs,
        padding=True,
        truncation=True,
        max_length=8192,
        return_tensors="pt",
    )
    encoded = {key: value.to(DEVICE) for key, value in encoded.items()}

    with torch.inference_mode():
        outputs = MODEL(**encoded)
        embeddings = _mean_pool(outputs.last_hidden_state, encoded["attention_mask"])
        embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)

    return embeddings.cpu()


app = FastAPI(title="Awal Embedding Service")


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "awal-embedding-service",
        "model": MODEL_NAME,
        "device": DEVICE,
    }


@app.post("/embed")
def embed(request: EmbeddingRequest, authorization: str | None = Header(default=None)):
    _require_api_key(authorization)

    vectors = _embed(request.inputs)

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
