export type QueryIntent =
  | "casual"
  | "policy_advice"
  | "procedure"
  | "people"
  | "list"
  | "summary"
  | "definition"
  | "fact_lookup";

export type QueryProfile = {
  intent: QueryIntent;
  retrievalQuery: string;
  preferredCardKinds: string[];
  answerGuidance: string;
};

const POLICY_ADVICE_TERMS = [
  "allowed",
  "approval",
  "approve",
  "can i",
  "can we",
  "compliance",
  "disclose",
  "do i need",
  "is it okay",
  "permitted",
  "policy",
  "prohibited",
  "chatgpt",
  "friend",
  "friends",
  "home",
  "outside",
  "personal",
  "required",
  "risk",
  "send",
  "share",
  "should i",
  "take",
  "violate",
  "whatsapp"
];

const PROCEDURE_TERMS = [
  "before",
  "change",
  "procedure",
  "process",
  "require",
  "requires",
  "step",
  "steps",
  "workflow"
];

const PEOPLE_TERMS = [
  "head",
  "heads",
  "kodzo",
  "mentions",
  "name",
  "names",
  "patrick",
  "people",
  "person",
  "role",
  "seth",
  "unit",
  "who"
];

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function classifyQueryIntent(question: string): QueryIntent {
  const normalized = normalize(question);

  if (/^(hi|hello|hey|thanks|thank you|ok|okay|great)[.!?\s]*$/i.test(normalized)) {
    return "casual";
  }

  if (
    includesAny(normalized, POLICY_ADVICE_TERMS) &&
    /\b(can|should|allowed|permitted|prohibited|required|violate|okay|ok|need|must|outside|send|share|take|upload)\b/i.test(
      normalized
    )
  ) {
    return "policy_advice";
  }

  if (/\b(list|all|other|how many|which)\b/i.test(normalized)) {
    return "list";
  }

  if (/^(who|what of|what about)\b/i.test(normalized) || includesAny(normalized, PEOPLE_TERMS)) {
    return "people";
  }

  if (/\b(summarize|summary|overview|main things|main points)\b/i.test(normalized)) {
    return "summary";
  }

  if (/\b(define|definition|what is|what are|means|framework)\b/i.test(normalized)) {
    return "definition";
  }

  if (includesAny(normalized, PROCEDURE_TERMS)) {
    return "procedure";
  }

  return "fact_lookup";
}

function preferredKindsForIntent(intent: QueryIntent) {
  switch (intent) {
    case "policy_advice":
      return [
        "prohibition",
        "obligation",
        "requirement",
        "control",
        "approval",
        "exception",
        "procedure_step",
        "policy",
        "table_row"
      ];
    case "procedure":
      return ["procedure_step", "approval", "obligation", "requirement", "control", "table_row"];
    case "people":
      return ["entity", "role", "relationship", "table_row", "approval", "observation"];
    case "list":
      return ["entity", "role", "table_row", "relationship", "obligation", "observation"];
    case "summary":
      return ["document_overview", "summary", "heading", "observation", "obligation"];
    case "definition":
      return ["definition", "document_overview", "observation", "summary"];
    default:
      return [];
  }
}

function guidanceForIntent(intent: QueryIntent) {
  switch (intent) {
    case "policy_advice":
      return [
        "The user is asking for practical advice based on policy evidence.",
        "Answer with a clear decision posture: allowed, prohibited, required, recommended, or unclear from the documents.",
        "Start with the direct practical answer in natural language, then explain the document basis.",
        "If the evidence does not directly support a decision, use insufficient_evidence instead of guessing."
      ].join(" ");
    case "procedure":
      return "The user is asking what must happen in a process. Prioritize required steps, approvals, notifications, records, and responsible roles.";
    case "people":
      return "The user is asking about people, names, roles, or reporting structure. Prefer exact names and titles found in evidence. Do not infer hierarchy unless the evidence states it.";
    case "list":
      return "The user is asking for a list or count. List only items directly supported by evidence, and say when the documents do not support a complete count.";
    case "summary":
      return "The user is asking for a concise document-backed summary. Cover the main supported points and avoid unsupported generalization.";
    case "definition":
      return "The user is asking for meaning or framework. Use definitions and document-supported descriptions before broader explanation.";
    case "casual":
      return "The user is making casual conversation. Reply briefly and naturally.";
    default:
      return "Answer only from supplied evidence and be explicit when the evidence is insufficient.";
  }
}

function expandRetrievalQuery(question: string, intent: QueryIntent) {
  const expansions: Record<QueryIntent, string[]> = {
    casual: [],
    policy_advice: [
      "policy requirement prohibition permitted allowed unauthorized disclosure approval exception control compliance"
    ],
    procedure: ["procedure process step approval notification record responsibility requirement"],
    people: ["name person role head unit owner approver responsible department"],
    list: ["list names roles units table row responsibilities"],
    summary: ["summary overview purpose scope policy requirements"],
    definition: ["definition means refers to framework objective scope"],
    fact_lookup: []
  };

  const extra = expansions[intent];
  return extra.length > 0 ? [question, ...extra].join("\n") : question;
}

export function buildQueryProfile(question: string): QueryProfile {
  const intent = classifyQueryIntent(question);

  return {
    intent,
    retrievalQuery: expandRetrievalQuery(question, intent),
    preferredCardKinds: preferredKindsForIntent(intent),
    answerGuidance: guidanceForIntent(intent)
  };
}
