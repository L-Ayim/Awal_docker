type EvidenceMatch = {
  text: string;
  chunkIndex: number;
  documentTitle: string;
};

type ServiceConfig = {
  configured: boolean;
  baseUrl: string | null;
  apiKey: string | null;
};

type GenerationResult = {
  answer: string;
  answerState: "grounded_answer" | "insufficient_evidence";
  modelName: string | null;
  provider: "vast-openai-compatible" | "local-fallback";
};

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getServiceConfig(baseUrlValue: string | undefined, apiKeyValue: string | undefined) {
  const baseUrl = baseUrlValue?.trim() || "";
  const apiKey = apiKeyValue?.trim() || "";

  return {
    configured: Boolean(baseUrl),
    baseUrl: baseUrl ? trimTrailingSlash(baseUrl) : null,
    apiKey: apiKey || null
  } satisfies ServiceConfig;
}

export function getAiRuntimeConfig() {
  const generation = getServiceConfig(
    process.env.VAST_OPENAI_BASE_URL,
    process.env.VAST_OPENAI_API_KEY
  );
  const embeddings = getServiceConfig(
    process.env.EMBEDDING_BASE_URL,
    process.env.EMBEDDING_API_KEY
  );
  const rerank = getServiceConfig(process.env.RERANK_BASE_URL, process.env.RERANK_API_KEY);
  const llmModel = process.env.VAST_LLM_MODEL?.trim() || "Qwen/Qwen3-8B";
  const embeddingModel = process.env.VAST_EMBEDDING_MODEL?.trim() || "BAAI/bge-m3";
  const rerankModel =
    process.env.VAST_RERANK_MODEL?.trim() || "BAAI/bge-reranker-v2-m3";

  return {
    hasGenerationProvider: generation.configured,
    hasEmbeddingProvider: embeddings.configured,
    hasRerankProvider: rerank.configured,
    generationBaseUrl: generation.baseUrl,
    embeddingBaseUrl: embeddings.baseUrl,
    rerankBaseUrl: rerank.baseUrl,
    generationApiKey: generation.apiKey,
    embeddingApiKey: embeddings.apiKey,
    rerankApiKey: rerank.apiKey,
    llmModel,
    embeddingModel,
    rerankModel
  };
}

function buildEvidencePayload(query: string, matches: EvidenceMatch[]) {
  const evidence = matches
    .map((match, index) => {
      return [
        `[E${index + 1}]`,
        `document: ${match.documentTitle}`,
        `chunk: ${match.chunkIndex + 1}`,
        match.text
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Question:",
    query,
    "",
    "Evidence:",
    evidence,
    "",
    "Instructions:",
    "- Answer only from the evidence.",
    "- If the evidence is insufficient, respond with exactly: INSUFFICIENT_EVIDENCE",
    "- If you answer, cite evidence ids like [E1] or [E2] inline.",
    "- Do not use outside knowledge."
  ].join("\n");
}

async function postJson<TResponse>(
  url: string,
  params: {
    apiKey: string | null;
    body: unknown;
  }
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {})
    },
    body: JSON.stringify(params.body)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body}`);
  }

  return (await response.json()) as TResponse;
}

export async function generateEmbeddings(inputs: string[]) {
  const config = getAiRuntimeConfig();

  if (!config.hasEmbeddingProvider || !config.embeddingBaseUrl) {
    throw new Error("Embedding provider is not configured.");
  }

  const json = await postJson<{
    model: string;
    dimensions: number;
    data: Array<{
      index: number;
      embedding: number[];
    }>;
  }>(`${config.embeddingBaseUrl}/embed`, {
    apiKey: config.embeddingApiKey,
    body: {
      inputs
    }
  });

  return json;
}

export async function rerankEvidence(params: {
  query: string;
  matches: EvidenceMatch[];
}) {
  const config = getAiRuntimeConfig();

  if (!config.hasRerankProvider || !config.rerankBaseUrl) {
    return null;
  }

  const json = await postJson<{
    model: string;
    data: Array<{
      index: number;
      score: number;
    }>;
  }>(`${config.rerankBaseUrl}/rerank`, {
    apiKey: config.rerankApiKey,
    body: {
      query: params.query,
      documents: params.matches.map((match) => match.text)
    }
  });

  return json;
}

export async function generateGroundedAnswer(params: {
  query: string;
  matches: EvidenceMatch[];
}): Promise<GenerationResult> {
  const config = getAiRuntimeConfig();

  if (!config.hasGenerationProvider || !config.generationBaseUrl) {
    return {
      answer: "",
      answerState: "insufficient_evidence",
      modelName: null,
      provider: "local-fallback"
    };
  }

  const json = await postJson<{
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
    model?: string;
  }>(`${config.generationBaseUrl}/chat/completions`, {
    apiKey: config.generationApiKey,
    body: {
      model: config.llmModel,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are Awal. Answer only from supplied evidence. If the evidence is insufficient, return exactly INSUFFICIENT_EVIDENCE."
        },
        {
          role: "user",
          content: buildEvidencePayload(params.query, params.matches)
        }
      ]
    }
  });

  const content = json.choices?.[0]?.message?.content?.trim() || "";

  if (!content || content === "INSUFFICIENT_EVIDENCE") {
    return {
      answer:
        "I could not produce a grounded answer from the retrieved evidence set.",
      answerState: "insufficient_evidence",
      modelName: json.model || config.llmModel,
      provider: "vast-openai-compatible"
    };
  }

  return {
    answer: content,
    answerState: "grounded_answer",
    modelName: json.model || config.llmModel,
    provider: "vast-openai-compatible"
  };
}
