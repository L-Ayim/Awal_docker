import { z } from "zod";
import type { QueryProfile } from "@/lib/query-understanding";

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

type MemoryObject = {
  chunkIndex: number;
  kind: string;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  aliases: string[];
};

const answerSegmentSchema = z.union([
  z.string().trim().min(1).max(1200),
  z.object({
    text: z.string().trim().min(1).max(1200),
    evidenceIds: z.array(z.number().int().positive()).max(5).default([])
  })
]);

const bulletSegmentSchema = z.union([
  z.string().trim().min(1).max(600),
  z.object({
    text: z.string().trim().min(1).max(600),
    evidenceIds: z.array(z.number().int().positive()).max(5).default([])
  })
]);

const structuredAnswerSchema = z.object({
  responseKind: z.enum(["conversational", "grounded", "insufficient_evidence"]),
  lead: answerSegmentSchema,
  bullets: z.array(bulletSegmentSchema).max(4).default([])
});

const memoryObjectSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  kind: z.string().trim().min(2).max(40),
  title: z.string().trim().min(2).max(180),
  body: z.string().trim().min(12).max(1600),
  summary: z.string().trim().min(8).max(360),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  aliases: z.array(z.string().trim().min(1).max(120)).max(8).default([])
});

const memoryObjectResponseSchema = z.object({
  objects: z.array(memoryObjectSchema).max(32).default([])
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
  const llmModel = process.env.VAST_LLM_MODEL?.trim() || "Qwen/Qwen3-14B";
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

function buildProfileLines(queryProfile?: Pick<QueryProfile, "intent" | "answerGuidance">) {
  return queryProfile
    ? [`Question intent: ${queryProfile.intent}`, `Answer guidance: ${queryProfile.answerGuidance}`]
    : [];
}

function buildEvidencePayload(
  query: string,
  matches: EvidenceMatch[],
  queryProfile?: Pick<QueryProfile, "intent" | "answerGuidance">
) {
  if (matches.length === 0) {
    return [
      "Question:",
      query,
      ...buildProfileLines(queryProfile),
      "",
      "Evidence candidates:",
      "(none)",
      "",
      "Return JSON with this exact shape:",
      '{"responseKind":"conversational|grounded|insufficient_evidence","lead":{"text":"...","evidenceIds":[]},"bullets":[{"text":"...","evidenceIds":[1]}]}',
      "",
      "Rules:",
      "- Use the supplied question intent and answer guidance when present.",
      "- Decide the user's intent yourself if no question intent is supplied.",
      "- If the user is making casual conversation such as a greeting, a thank-you, or a simple check-in, use responseKind conversational.",
      "- If the user asks about anything that is not represented in the user's documents, use responseKind insufficient_evidence and politely say you can only answer from the processed documents.",
      "- Do not invent document facts.",
      "- Do not answer from general knowledge, even for common public topics.",
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
    ...buildProfileLines(queryProfile),
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
    "- For advice or decision questions, start with a direct practical posture in natural language. Avoid repeating stock openings like 'Based on the documents' unless it is needed for clarity.",
    "- For advice or decision questions, include what the user should do next only when the evidence supports it.",
    "- If the user gives a concrete example such as an app, channel, tool, person, or scenario, do not say the documents explicitly mention that example unless the exact example appears inside the Evidence candidates themselves. The example appearing in the Question does not count as evidence. If the evidence only gives a broader rule, say the user's example falls under that broader rule rather than claiming the document named the example.",
    "- Example discipline: if the question mentions a specific tool, person, place, product, channel, or scenario but the evidence only states a broader rule or category, do not claim the document names the specific example. Explain that the example appears to fall under the broader documented rule only when that connection is clear.",
    "- Every factual claim must be backed by evidenceIds whose evidence directly supports that claim. Do not attach weak or tangential evidence just to create citations.",
    "- For comparison questions, use evidence for each side being compared. If the evidence only supports one side, answer only that supported part and state that the other side is not sufficiently represented in the retrieved evidence.",
    "- For list or count questions, do not imply the list is complete unless the evidence supports completeness.",
    "- Use responseKind grounded only when the supplied evidence is enough to support the answer.",
    "- Use responseKind insufficient_evidence when the evidence is missing, weak, not directly on point, or the user asks about a general outside topic.",
    "- Do not answer outside-knowledge questions from memory. For those, politely say you can only answer from the processed documents.",
    "- The lead should be one direct sentence.",
    "- Bullets are optional, but use at most 3 short bullets.",
    "- Do not include citations in the text. Put only evidence ids in evidenceIds arrays.",
    "- Do not mention chunk numbers, candidate numbers, or retrieval mechanics.",
    "- Do not use outside knowledge.",
    "- Return JSON only."
  ].join("\n");
}

function buildAnswerVerificationPayload(params: {
  query: string;
  matches: EvidenceMatch[];
  queryProfile?: Pick<QueryProfile, "intent" | "answerGuidance">;
  draft: {
    responseKind: "conversational" | "grounded" | "insufficient_evidence";
    lead: AnswerSegment;
    bullets: AnswerSegment[];
  };
}) {
  const evidence = params.matches
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
        `[${index + 1}] ${match.documentTitle}${location ? ` (${location})` : ""}`,
        match.text.length > 900 ? `${match.text.slice(0, 897).trimEnd()}...` : match.text
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Question:",
    params.query,
    ...buildProfileLines(params.queryProfile),
    "",
    "Draft answer JSON:",
    JSON.stringify(params.draft),
    "",
    "Evidence candidates:",
    evidence || "(none)",
    "",
    "Return JSON with this exact shape:",
    '{"responseKind":"conversational|grounded|insufficient_evidence","lead":{"text":"...","evidenceIds":[1]},"bullets":[{"text":"...","evidenceIds":[1,2]}]}',
    "",
    "Verifier rules:",
    "- Verify every factual claim in the draft against the evidence candidates.",
    "- Keep only claims directly supported by their evidenceIds. Rewrite or remove claims that are unsupported, over-specific, or only generally implied.",
    "- If the question contains a concrete example, the example itself is not evidence. Only say a document explicitly mentions that example if the example appears in the evidence text.",
    "- If a concrete example is covered by a broader documented rule, keep a grounded answer but phrase it as falling under that broader rule. Do not return insufficient_evidence just because the exact example is absent when the broader source rule clearly applies.",
    "- Remove weak or tangential evidenceIds. Do not cite evidence that does not directly support the sentence.",
    "- For comparisons, include evidenceIds for each side being compared; otherwise narrow the answer or use insufficient_evidence.",
    "- Use insufficient_evidence if the remaining supported claims do not answer the question.",
    "- Do not add new facts beyond the evidence.",
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

function cleanAnswerText(text: string) {
  return text
    .replace(/\s+-\s*bullets\s*\[[\s\S]*$/i, "")
    .replace(/\s*bullets\s*\[[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSegment(
  segment: string | { text: string; evidenceIds?: number[] },
  matchCount: number
): AnswerSegment {
  if (typeof segment === "string") {
    return {
      text: cleanAnswerText(segment),
      evidenceIds: []
    };
  }

  return {
    text: cleanAnswerText(segment.text),
    evidenceIds: normalizeEvidenceIds(segment.evidenceIds ?? [], matchCount)
  };
}

function parseStructuredAnswer(content: string, matchCount: number) {
  const raw = JSON.parse(extractJsonObject(content));
  const parsed = structuredAnswerSchema.parse(raw);

  const lead = normalizeSegment(parsed.lead, matchCount);
  const bullets = parsed.bullets.map((bullet) => normalizeSegment(bullet, matchCount));

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
        text: lead.text,
        evidenceIds: []
      },
      bullets: bullets.map((bullet) => ({ ...bullet, evidenceIds: [] }))
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

async function requestStructuredChatCompletion(params: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  requireJsonMode?: boolean;
  maxTokens?: number;
}) {
  return postJson<{
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
    model?: string;
  }>(`${params.baseUrl}/chat/completions`, {
    apiKey: params.apiKey,
    body: {
      model: params.model,
      temperature: 0,
      max_tokens: params.maxTokens ?? 900,
      ...(params.requireJsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: params.messages
    }
  });
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

async function verifyGroundedAnswer(params: {
  config: ReturnType<typeof getAiRuntimeConfig>;
  query: string;
  matches: EvidenceMatch[];
  queryProfile?: Pick<QueryProfile, "intent" | "answerGuidance">;
  draft: {
    responseKind: "conversational" | "grounded" | "insufficient_evidence";
    lead: AnswerSegment;
    bullets: AnswerSegment[];
  };
}) {
  if (
    params.draft.responseKind !== "grounded" ||
    params.matches.length === 0 ||
    !params.config.hasGenerationProvider ||
    !params.config.generationBaseUrl
  ) {
    return params.draft;
  }

  const messages = [
    {
      role: "system" as const,
      content:
        "You are Awal's evidence verifier. Your job is to audit a drafted document-grounded answer against supplied evidence before it is shown to the user. Be strict: direct evidence is required for every factual claim. Rewrite unsupported wording into narrower supported wording, or return insufficient_evidence. Return JSON only. Do not reveal reasoning."
    },
    {
      role: "user" as const,
      content: buildAnswerVerificationPayload(params)
    }
  ];

  let lastError: Error | null = null;

  for (const requireJsonMode of [true, false]) {
    try {
      const json = await requestStructuredChatCompletion({
        baseUrl: params.config.generationBaseUrl,
        apiKey: params.config.generationApiKey,
        model: params.config.llmModel,
        messages,
        requireJsonMode,
        maxTokens: 550
      });
      const content = sanitizeGeneratedAnswer(json.choices?.[0]?.message?.content || "");
      const verified = parseStructuredAnswer(content, params.matches.length);

      if (verified.responseKind === "insufficient_evidence" && params.draft.responseKind === "grounded") {
        return params.draft;
      }

      return verified;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("answer_verification_failed");
    }
  }

  console.warn("answer_verification_failed", lastError);
  return params.draft;
}

export async function generateGroundedAnswer(params: {
  query: string;
  matches: EvidenceMatch[];
  queryProfile?: Pick<QueryProfile, "intent" | "answerGuidance">;
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

  const messages = [
    {
      role: "system" as const,
      content:
        "You are Awal, a document-grounded assistant for practical questions about user-provided source material. Sound natural and direct, not templated. You may respond naturally to greetings and simple social check-ins, but factual answers and advice must be grounded only in the supplied document evidence. When the user asks for advice, interpret the documents into a practical decision posture while staying conservative: say allowed, prohibited, required, recommended, or unclear only when the evidence supports that posture. Vary your wording and avoid repeatedly opening with phrases like 'Based on the documents.' If the user asks about a topic outside the documents, do not use general knowledge; respond with insufficient_evidence and politely say you can only answer from the processed documents. The runtime, not you, will render final citations, so never write citations in the answer text. Return JSON only, matching the requested schema exactly. Do not reveal chain-of-thought. Do not output <think> tags or hidden reasoning."
    },
    {
      role: "user" as const,
      content: buildEvidencePayload(params.query, params.matches, params.queryProfile)
    }
  ];

  let json: {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
    model?: string;
  } | null = null;
  let parsed:
    | {
        responseKind: "conversational" | "grounded" | "insufficient_evidence";
        lead: AnswerSegment;
        bullets: AnswerSegment[];
      }
    | null = null;
  let lastError: Error | null = null;

  for (const requireJsonMode of [true, false]) {
    try {
      json = await requestStructuredChatCompletion({
        baseUrl: config.generationBaseUrl,
        apiKey: config.generationApiKey,
        model: config.llmModel,
        messages,
        requireJsonMode,
        maxTokens: 850
      });

      const content = sanitizeGeneratedAnswer(json.choices?.[0]?.message?.content || "");
      parsed = parseStructuredAnswer(content, params.matches.length);
      lastError = null;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("structured_generation_failed");
    }
  }

  if (!json || !parsed) {
    throw lastError ?? new Error("structured_generation_failed");
  }

  if (parsed.responseKind === "insufficient_evidence") {
    return {
      responseKind: "insufficient_evidence",
      lead: {
        text: parsed.lead.text,
        evidenceIds: []
      },
      bullets: [],
      answerState: "insufficient_evidence",
      modelName: json.model || config.llmModel,
      provider: "vast-openai-compatible"
    };
  }

  const verified = await verifyGroundedAnswer({
    config,
    query: params.query,
    matches: params.matches,
    queryProfile: params.queryProfile,
    draft: parsed
  });

  if (verified.responseKind === "insufficient_evidence") {
    return {
      responseKind: "insufficient_evidence",
      lead: {
        text: verified.lead.text,
        evidenceIds: []
      },
      bullets: [],
      answerState: "insufficient_evidence",
      modelName: json.model || config.llmModel,
      provider: "vast-openai-compatible"
    };
  }

  return {
    responseKind: verified.responseKind,
    lead: verified.lead,
    bullets: verified.bullets,
    answerState:
      verified.responseKind === "grounded" || verified.responseKind === "conversational"
        ? "grounded_answer"
        : "insufficient_evidence",
    modelName: json.model || config.llmModel,
    provider: "vast-openai-compatible"
  };
}

export async function generateDocumentMemoryObjects(params: {
  documentTitle: string;
  chunks: Array<{
    chunkIndex: number;
    text: string;
    pageStart: number | null;
    pageEnd: number | null;
    paragraphStart: number | null;
    paragraphEnd: number | null;
    lineStart: number | null;
    lineEnd: number | null;
  }>;
}) {
  const config = getAiRuntimeConfig();

  if (!config.hasGenerationProvider || !config.generationBaseUrl || params.chunks.length === 0) {
    return {
      objects: [] as MemoryObject[],
      modelName: null,
      provider: "local-fallback" as const
    };
  }

  const chunkPayload = params.chunks
    .map((chunk) => {
      const location = [
        chunk.pageStart !== null
          ? chunk.pageEnd !== null && chunk.pageEnd !== chunk.pageStart
            ? `pages ${chunk.pageStart}-${chunk.pageEnd}`
            : `page ${chunk.pageStart}`
          : null,
        chunk.paragraphStart !== null
          ? chunk.paragraphEnd !== null && chunk.paragraphEnd !== chunk.paragraphStart
            ? `paragraphs ${chunk.paragraphStart}-${chunk.paragraphEnd}`
            : `paragraph ${chunk.paragraphStart}`
          : null,
        chunk.lineStart !== null
          ? chunk.lineEnd !== null && chunk.lineEnd !== chunk.lineStart
            ? `lines ${chunk.lineStart}-${chunk.lineEnd}`
            : `line ${chunk.lineStart}`
          : null
      ]
        .filter(Boolean)
        .join(", ");

      return [
        `Chunk ${chunk.chunkIndex}`,
        location ? `Location: ${location}` : null,
        chunk.text
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const messages = [
    {
      role: "system" as const,
      content:
        "You are building a semantic memory layer for document retrieval. Extract durable memory objects from the supplied document chunks. Do not use a fixed taxonomy; choose short, reusable kind labels that fit the source content such as summary, entity, role, obligation, prohibition, exception, fact, definition, relationship, table_row, heading, observation, approval, control, or procedure_step. Only emit objects that are directly supported by the chunk text. Prefer precise titles and concise summaries. Keep aliases to exact names, roles, acronyms, or variant phrasings found in the text. Return JSON only."
    },
    {
      role: "user" as const,
      content: [
        `Document title: ${params.documentTitle}`,
        "",
        "Chunks:",
        chunkPayload,
        "",
        'Return JSON with shape: {"objects":[{"chunkIndex":0,"kind":"...","title":"...","body":"...","summary":"...","tags":["..."],"aliases":["..."]}]}',
        "",
        "Rules:",
        "- Extract up to 4 memory objects per chunk.",
        "- Good targets include obligations, prohibitions, exceptions, controls, entities, names, approvals, table facts, definitions, responsibilities, headings, process steps, and notable observations.",
        "- Skip boilerplate, image markers, navigation text, and empty material.",
        "- kind must be short snake_case or a short lowercase label.",
        "- body must stay grounded in the chunk text.",
        "- Do not invent facts or merge information across chunks.",
        "- Return JSON only."
      ].join("\n")
    }
  ];

  let json: {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
    model?: string;
  } | null = null;
  let parsed: z.infer<typeof memoryObjectResponseSchema> | null = null;
  let lastError: Error | null = null;

  for (const requireJsonMode of [true, false]) {
    try {
      json = await requestStructuredChatCompletion({
        baseUrl: config.generationBaseUrl,
        apiKey: config.generationApiKey,
        model: config.llmModel,
        messages,
        requireJsonMode
      });

      const content = sanitizeGeneratedAnswer(json.choices?.[0]?.message?.content || "");
      parsed = memoryObjectResponseSchema.parse(JSON.parse(extractJsonObject(content)));
      lastError = null;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("memory_object_generation_failed");
    }
  }

  if (!json || !parsed) {
    throw lastError ?? new Error("memory_object_generation_failed");
  }

  return {
    objects: parsed.objects,
    modelName: json.model || config.llmModel,
    provider: "vast-openai-compatible" as const
  };
}
