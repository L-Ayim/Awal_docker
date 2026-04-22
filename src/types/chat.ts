export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
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
