export type ChatRole = "user" | "assistant" | "system";

export type ChatCitation = {
  citationOrder: number;
  quotedText: string;
  locationLabel: string;
  pageStart: number | null;
  pageEnd: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  document: {
    id: string;
    title: string;
    mimeType: string;
  };
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  answerRecord?: {
    state: string;
    modelName: string | null;
    citations: ChatCitation[];
  } | null;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
  messageCount?: number;
  messagesLoaded?: boolean;
};

export type ChatBootstrap = {
  workspaceId: string;
  collectionId: string;
};
