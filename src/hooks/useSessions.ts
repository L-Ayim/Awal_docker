"use client";

import { useEffect, useState } from "react";
import type {
  ChatBootstrap,
  ChatCitation,
  ChatMessage,
  ChatSession,
  ChatRole
} from "@/types/chat";

type BootstrapResponse = {
  workspace: {
    id: string;
  };
  collection: {
    id: string;
  };
};

type ConversationsResponse = {
  conversations: Array<{
    id: string;
    title: string | null;
    createdAt: string;
    _count?: {
      messages: number;
    };
  }>;
};

type MessagesResponse = {
  messages: Array<{
    id: string;
    role: ChatRole;
    content: string;
    createdAt: string;
    answerRecord?: {
      state: string;
      modelName: string | null;
      citations: ChatCitation[];
    } | null;
  }>;
};

type CreateConversationResponse = {
  conversation: {
    id: string;
    title: string | null;
    createdAt: string;
  };
};

type CreateMessageResponse = {
  userMessage: {
    id: string;
    role: ChatRole;
    content: string;
    createdAt: string;
    answerRecord?: {
      state: string;
      modelName: string | null;
      citations: ChatCitation[];
    } | null;
  };
  assistantMessage: {
    id: string;
    role: ChatRole;
    content: string;
    createdAt: string;
    answerRecord?: {
      state: string;
      modelName: string | null;
      citations: ChatCitation[];
    } | null;
  };
};

function mapMessage(message: {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  answerRecord?: {
    state: string;
    modelName: string | null;
    citations: ChatCitation[];
  } | null;
}): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: new Date(message.createdAt).getTime(),
    answerRecord: message.answerRecord ?? null
  };
}

function mapSession(conversation: {
  id: string;
  title: string | null;
  createdAt: string;
  _count?: {
    messages: number;
  };
}): ChatSession {
  return {
    id: conversation.id,
    title: conversation.title?.trim() || "New chat",
    createdAt: new Date(conversation.createdAt).getTime(),
    messages: [],
    messageCount: conversation._count?.messages ?? 0,
    messagesLoaded: false
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | T
    | { message?: string }
    | null;

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : "Request failed.";

    throw new Error(message);
  }

  return data as T;
}

export function useSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<ChatBootstrap | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function initialize() {
      try {
        setIsBootstrapping(true);
        setError(null);

        const bootstrapData = await parseJson<BootstrapResponse>(
          await fetch("/api/v1/bootstrap", {
            cache: "no-store"
          })
        );

        const nextBootstrap = {
          workspaceId: bootstrapData.workspace.id,
          collectionId: bootstrapData.collection.id
        };

        setBootstrap(nextBootstrap);

        const conversationsData = await parseJson<ConversationsResponse>(
          await fetch(
            `/api/v1/conversations?workspaceId=${nextBootstrap.workspaceId}&collectionId=${nextBootstrap.collectionId}`,
            {
              cache: "no-store"
            }
          )
        );

        if (conversationsData.conversations.length === 0) {
          const created = await createConversation(nextBootstrap, "New chat");
          setSessions([created]);
          setActiveSessionId(created.id);
          return;
        }

        const nextSessions = conversationsData.conversations.map(mapSession);
        setSessions(nextSessions);
        setActiveSessionId(nextSessions[0]?.id ?? null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load chat.");
      } finally {
        setIsBootstrapping(false);
      }
    }

    void initialize();
  }, []);

  useEffect(() => {
    async function loadMessages(sessionId: string) {
      const target = sessions.find((session) => session.id === sessionId);
      if (!target || target.messagesLoaded === true) {
        return;
      }

      try {
        setError(null);

        const data = await parseJson<MessagesResponse>(
          await fetch(`/api/v1/conversations/${sessionId}/messages`, {
            cache: "no-store"
          })
        );

        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: data.messages.map(mapMessage),
                  messageCount: data.messages.length,
                  messagesLoaded: true
                }
              : session
          )
        );
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load messages.");
      }
    }

    if (activeSessionId) {
      void loadMessages(activeSessionId);
    }
  }, [activeSessionId, sessions]);

  async function createConversation(nextBootstrap: ChatBootstrap, title?: string) {
    const data = await parseJson<CreateConversationResponse>(
      await fetch("/api/v1/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId: nextBootstrap.workspaceId,
          collectionId: nextBootstrap.collectionId,
          title
        })
      })
    );

    return {
      id: data.conversation.id,
      title: data.conversation.title?.trim() || "New chat",
      createdAt: new Date(data.conversation.createdAt).getTime(),
      messages: [],
      messageCount: 0,
      messagesLoaded: true
    } satisfies ChatSession;
  }

  const createNewSession = async () => {
    if (!bootstrap) return;

    try {
      setError(null);
      const next = await createConversation(bootstrap, "New chat");
      setSessions((current) => [next, ...current]);
      setActiveSessionId(next.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create chat.");
    }
  };

  const deleteSession = async (id: string) => {
    try {
      setError(null);
      await parseJson<{ success: boolean }>(
        await fetch(`/api/v1/conversations/${id}`, {
          method: "DELETE"
        })
      );

      const remaining = sessions.filter((session) => session.id !== id);

      if (remaining.length === 0 && bootstrap) {
        const seed = await createConversation(bootstrap, "New chat");
        setSessions([seed]);
        setActiveSessionId(seed.id);
        return;
      }

      setSessions(remaining);

      if (activeSessionId === id) {
        setActiveSessionId(remaining[0]?.id ?? null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete chat.");
    }
  };

  const updateSessionTitle = async (id: string, title: string) => {
    const nextTitle = title.trim() || "New chat";

    try {
      setError(null);
      await parseJson(
        await fetch(`/api/v1/conversations/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title: nextTitle
          })
        })
      );

      setSessions((current) =>
        current.map((session) =>
          session.id === id ? { ...session, title: nextTitle } : session
        )
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to rename chat.");
    }
  };

  const setSessionMessages = (sessionId: string, messages: ChatMessage[]) => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages,
              messageCount: messages.length,
              messagesLoaded: true
            }
          : session
      )
    );
  };

  const sendMessage = async (content: string) => {
    const nextContent = content.trim();
    if (!activeSessionId || !nextContent || isSending) {
      return;
    }

    try {
      setIsSending(true);
      setError(null);

      const data = await parseJson<CreateMessageResponse>(
        await fetch(`/api/v1/conversations/${activeSessionId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            content: nextContent
          })
        })
      );

      const appended = [mapMessage(data.userMessage), mapMessage(data.assistantMessage)];

      setSessions((current) =>
        current.map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                messages: [...session.messages, ...appended],
                messageCount: (session.messageCount ?? session.messages.length) + appended.length,
                messagesLoaded: true,
                title:
                  session.title === "New chat"
                    ? nextContent.slice(0, 48)
                    : session.title
              }
            : session
        )
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to send message.");
    } finally {
      setIsSending(false);
    }
  };

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    bootstrap,
    isBootstrapping,
    isSending,
    error,
    createNewSession,
    deleteSession,
    updateSessionTitle,
    sendMessage,
    setSessionMessages
  };
}
