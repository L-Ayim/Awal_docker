import { z } from "zod";

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

type AnswerSegment = {
  text: string;
  evidenceIds: number[];
};

type ServiceConfig = {
  configured: boolean;
  baseUrl: string | null;
  apiKey: string | null;
};

type GenerationResult = {
  responseKind: "conversational" | "grounded" | "insufficient_evidence";
  lead: AnswerSegment;
  bullets: AnswerSegment[];
  answerState: "grounded_answer" | "insufficient_evidence";
  modelName: string | null;
  provider: "vast-openai-compatible" | "local-fallback";
};

const structuredAnswerSchema = z.object({
  responseKind: z.enum(["conversational", "grounded", "insufficient_evidence"]),
  lead: z.object({
    text: z.string().trim().min(1).max(1200),
    evidenceIds: z.array(z.number().int().positive()).max(5).default([])
  }),
  bullets: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(600),
        evidenceIds: z.array(z.number().int().positive()).max(5).default([])
      })
    )
    .max(4)
    .default([])
});

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
  if (matches.length === 0) {
    return [
      "Question:",
      query,
      "",
      "Evidence candidates:",
      "(none)",
      "",
      "Return JSON with this exact shape:",
      '{"responseKind":"conversational|grounded|insufficient_evidence","lead":{"text":"...","evidenceIds":[]},"bullets":[{"text":"...","evidenceIds":[1]}]}',
      "",
      "Rules:",
      "- Decide the user's intent yourself.",
      "- If the user is making casual conversation such as a greeting, a thank-you, or a simple check-in, use responseKind conversational.",
      "- If the user is asking for document-backed facts and there is no usable evidence, use responseKind insufficient_evidence.",
      "- Do not invent document facts.",
      "- Do not include citations in the text. Put only evidence ids in evidenceIds arrays.",
      "- If responseKind is conversational or insufficient_evidence, evidenceIds must be empty arrays.",
      "- Return JSON only."
    ].join("\n");
  }

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
    "Evidence candidates:",
    evidence,
    "",
    "Return JSON with this exact shape:",
    '{"responseKind":"conversational|grounded|insufficient_evidence","lead":{"text":"...","evidenceIds":[1]},"bullets":[{"text":"...","evidenceIds":[1,2]}]}',
    "",
    "Rules:",
    "- Read the question and decide whether the evidence is actually needed to answer it.",
    "- If the user is making casual conversation, use responseKind conversational and answer naturally in one short sentence.",
    "- If the user is asking for document-backed information, think through which evidence candidates are truly relevant before answering.",
    "- Use responseKind grounded only when the supplied evidence is enough to support the answer.",
    "- Use responseKind insufficient_evidence when the evidence is missing, weak, or not directly on point.",
    "- The lead should be one direct sentence.",
    "- Bullets are optional, but use at most 3 short bullets.",
    "- Do not include citations in the text. Put only evidence ids in evidenceIds arrays.",
    "- Do not mention chunk numbers, candidate numbers, or retrieval mechanics.",
    "- Do not use outside knowledge.",
    "- Return JSON only."
  ].join("\n");
}

function sanitizeGeneratedAnswer(content: string) {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*think\s*[\r\n]+/gi, "")
    .trim();
}

function extractJsonObject(content: string) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("Model did not return a JSON object.");
  }

  return content.slice(start, end + 1);
}

function normalizeEvidenceIds(evidenceIds: number[], matchCount: number) {
  return Array.from(
    new Set(
      evidenceIds.filter(
        (value) => Number.isInteger(value) && value >= 1 && value <= matchCount
      )
    )
  );
}

function parseStructuredAnswer(content: string, matchCount: number) {
  const raw = JSON.parse(extractJsonObject(content));
  const parsed = structuredAnswerSchema.parse(raw);

  const lead: AnswerSegment = {
    text: parsed.lead.text.trim(),
    evidenceIds: normalizeEvidenceIds(parsed.lead.evidenceIds, matchCount)
  };

  const bullets = parsed.bullets.map((bullet) => ({
    text: bullet.text.trim(),
    evidenceIds: normalizeEvidenceIds(bullet.evidenceIds, matchCount)
  }));

  if (parsed.responseKind === "conversational") {
    return {
      responseKind: parsed.responseKind,
      lead: { ...lead, evidenceIds: [] },
      bullets: []
    };
  }

  if (parsed.responseKind !== "grounded") {
    return {
      responseKind: parsed.responseKind,
      lead: { ...lead, evidenceIds: [] },
      bullets: bullets.map((bullet) => ({ ...bullet, evidenceIds: [] }))
    };
  }

  const groundedEvidenceCount =
    lead.evidenceIds.length + bullets.reduce((sum, bullet) => sum + bullet.evidenceIds.length, 0);

  if (groundedEvidenceCount === 0) {
    return {
      responseKind: "insufficient_evidence" as const,
      lead: {
        text: "I couldn't find enough grounded evidence in the processed documents to answer that confidently.",
        evidenceIds: []
      },
      bullets: []
    };
  }

  return {
    responseKind: parsed.responseKind,
    lead,
    bullets
  };
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
      responseKind: "insufficient_evidence",
      lead: {
        text: "",
        evidenceIds: []
      },
      bullets: [],
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
            "You are Awal. Decide whether the user needs a conversational reply, a grounded document answer, or an insufficient-evidence response. When evidence candidates are supplied, think through which ones are actually relevant before answering. The runtime, not you, will render final citations, so never write citations in the answer text. Return JSON only, matching the requested schema exactly. Do not reveal chain-of-thought. Do not output <think> tags or hidden reasoning."
        },
        {
          role: "user",
          content: buildEvidencePayload(params.query, params.matches)
        }
      ]
    }
  });

  const content = sanitizeGeneratedAnswer(json.choices?.[0]?.message?.content || "");
  const parsed = parseStructuredAnswer(content, params.matches.length);

  if (parsed.responseKind === "insufficient_evidence") {
    return {
      responseKind: "insufficient_evidence",
      lead: {
        text:
        "I couldn't find enough grounded evidence in the processed documents to answer that confidently.",
        evidenceIds: []
      },
      bullets: [],
      answerState: "insufficient_evidence",
      modelName: json.model || config.llmModel,
      provider: "vast-openai-compatible"
    };
  }

  return {
    responseKind: parsed.responseKind,
    lead: parsed.lead,
    bullets: parsed.bullets,
    answerState:
      parsed.responseKind === "grounded" || parsed.responseKind === "conversational"
        ? "grounded_answer"
        : "insufficient_evidence",
    modelName: json.model || config.llmModel,
    provider: "vast-openai-compatible"
  };
}
