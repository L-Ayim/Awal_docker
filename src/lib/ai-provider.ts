type EvidenceMatch = {
  text: string;
  chunkIndex: number;
  documentTitle: string;
  pageStart: number | null;
  pageEnd: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
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
      const location = [
        match.pageStart !== null
          ? match.pageEnd !== null && match.pageEnd !== match.pageStart
            ? `pages ${match.pageStart}-${match.pageEnd}`
            : `page ${match.pageStart}`
          : null,
        match.paragraphStart !== null
          ? match.paragraphEnd !== null && match.paragraphEnd !== match.paragraphStart
            ? `paragraphs ${match.paragraphStart}-${match.paragraphEnd}`
            : `paragraph ${match.paragraphStart}`
          : null,
        match.lineStart !== null
          ? match.lineEnd !== null && match.lineEnd !== match.lineStart
            ? `lines ${match.lineStart}-${match.lineEnd}`
            : `line ${match.lineStart}`
          : null
      ]
        .filter(Boolean)
        .join(", ");

      return [
        `[${index + 1}]`,
        `document: ${match.documentTitle}`,
        `location: ${location || `chunk ${match.chunkIndex + 1}`}`,
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
    "- Keep the answer short: one direct lead sentence, then 2 to 4 short bullet points maximum.",
    "- Write in a friendly, direct tone, but do not sound robotic.",
    "- Prefer the most directly relevant document instead of listing many loosely related documents.",
    "- When the evidence spans multiple documents, synthesize it into one answer instead of answering from only one source.",
    "- Every factual sentence or bullet must cite evidence inline using this style: [1, page 2, lines 4-9].",
    "- Do not dump raw snippets or quote long passages unless necessary.",
    "- Do not use outside knowledge."
  ].join("\n");
}

function sanitizeGeneratedAnswer(content: string) {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*think\s*[\r\n]+/gi, "")
    .trim();
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
            "You are Awal. Answer only from supplied evidence. Give a direct answer first, then short supporting bullets. Prefer the most relevant document instead of broad keyword-matched lists. Every factual statement must include an inline citation with evidence id and page or line information when available, for example [1, page 3, lines 10-16]. If the evidence is insufficient, return exactly INSUFFICIENT_EVIDENCE. Do not reveal chain-of-thought. Do not output <think> tags or hidden reasoning."
        },
        {
          role: "user",
          content: buildEvidencePayload(params.query, params.matches)
        }
      ]
    }
  });

  const content = sanitizeGeneratedAnswer(json.choices?.[0]?.message?.content || "");

  if (!content || content === "INSUFFICIENT_EVIDENCE") {
    return {
      answer:
        "I couldn't find enough grounded evidence in the processed documents to answer that confidently.",
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
