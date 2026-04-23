"use client";

import { useEffect, useRef, useState } from "react";
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

type StreamEvent =
  | { type: "status"; data: { stage: "queued" | "generating" | "streaming" } }
  | { type: "user_message"; data: CreateMessageResponse["userMessage"] }
  | { type: "assistant_delta"; data: { delta: string } }
  | { type: "done"; data: CreateMessageResponse }
  | { type: "error"; data: { message: string } };

type UploadableFile = File & {
  webkitRelativePath?: string;
};

type QueuedMessage = {
  id: string;
  sessionId: string;
  content: string;
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
    status: "complete",
    answerRecord: message.answerRecord ?? null
  };
}

function makeTempId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseSseFrames(buffer: string, onEvent: (event: StreamEvent) => void) {
  const frames = buffer.split("\n\n");

  for (const frame of frames) {
    const trimmed = frame.trim();

    if (!trimmed) {
      continue;
    }

    const eventLine = trimmed.match(/^event:\s*(.+)$/m);
    const dataLine = trimmed.match(/^data:\s*([\s\S]+)$/m);

    if (!eventLine || !dataLine) {
      continue;
    }

    try {
      onEvent({
        type: eventLine[1] as StreamEvent["type"],
        data: JSON.parse(dataLine[1]) as never
      });
    } catch {
      continue;
    }
  }
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
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const activeRequestRef = useRef<AbortController | null>(null);

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

  const sendMessage = async (content: string, targetSessionId?: string) => {
    const nextContent = content.trim();
    const sessionId = targetSessionId ?? activeSessionId;

    if (!sessionId || !nextContent) {
      return;
    }

    if (isSending) {
      setQueuedMessages((current) => [
        ...current,
        {
          id: makeTempId("queued"),
          sessionId,
          content: nextContent
        }
      ]);
      return;
    }

    const optimisticUserId = makeTempId("user");
    const optimisticAssistantId = makeTempId("assistant");
    const optimisticUser: ChatMessage = {
      id: optimisticUserId,
      role: "user",
      content: nextContent,
      createdAt: Date.now(),
      status: "sending",
      answerRecord: null
    };
    const optimisticAssistant: ChatMessage = {
      id: optimisticAssistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      status: "sending",
      answerRecord: null
    };

    try {
      setIsSending(true);
      setError(null);
      const abortController = new AbortController();
      activeRequestRef.current = abortController;

      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                messages: [...session.messages, optimisticUser, optimisticAssistant],
                messageCount: (session.messageCount ?? session.messages.length) + 2,
                messagesLoaded: true,
                title:
                  session.title === "New chat"
                    ? nextContent.slice(0, 48)
                    : session.title
              }
            : session
        )
      );

      const response = await fetch(`/api/v1/conversations/${sessionId}/messages?stream=1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: abortController.signal,
        body: JSON.stringify({
          content: nextContent
        })
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message || "Failed to send message.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          parseSseFrames(frame, (event) => {
            if (event.type === "status") {
              setSessions((current) =>
                current.map((session) =>
                  session.id === sessionId
                    ? {
                        ...session,
                        messages: session.messages.map((message) =>
                          message.id === optimisticAssistantId
                            ? {
                                ...message,
                                status:
                                  event.data.stage === "streaming" ? "streaming" : "sending"
                              }
                            : message
                        )
                      }
                    : session
                )
              );
              return;
            }

            if (event.type === "assistant_delta") {
              setSessions((current) =>
                current.map((session) =>
                  session.id === sessionId
                    ? {
                        ...session,
                        messages: session.messages.map((message) =>
                          message.id === optimisticAssistantId
                            ? {
                                ...message,
                                content: `${message.content}${event.data.delta}`,
                                status: "streaming"
                              }
                            : message
                        )
                      }
                    : session
                )
              );
              return;
            }

            if (event.type === "user_message") {
              const mappedUser = mapMessage(event.data);
              setSessions((current) =>
                current.map((session) =>
                  session.id === sessionId
                    ? {
                        ...session,
                        messages: session.messages.map((message) =>
                          message.id === optimisticUserId ? mappedUser : message
                        )
                      }
                    : session
                )
              );
              return;
            }

            if (event.type === "done") {
              const mappedUser = mapMessage(event.data.userMessage);
              const mappedAssistant = mapMessage(event.data.assistantMessage);

              setSessions((current) =>
                current.map((session) =>
                  session.id === sessionId
                    ? {
                        ...session,
                        messages: session.messages.map((message) => {
                          if (message.id === optimisticUserId) {
                            return mappedUser;
                          }

                          if (message.id === optimisticAssistantId) {
                            return mappedAssistant;
                          }

                          return message;
                        })
                      }
                    : session
                )
              );
              return;
            }

            if (event.type === "error") {
              throw new Error(event.data.message);
            }
          });
        }
      }
    } catch (nextError) {
      const aborted = nextError instanceof DOMException && nextError.name === "AbortError";
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                messages: session.messages.map((message) =>
                  message.id === optimisticAssistantId
                    ? {
                        ...message,
                        content:
                          aborted
                            ? `${message.content.trim()}${message.content.trim() ? "\n\n" : ""}Response stopped.`
                            : nextError instanceof Error
                            ? nextError.message
                            : "Failed to send message.",
                        status: aborted ? "complete" : "error"
                      }
                    : message
                )
              }
            : session
        )
      );
      if (!aborted) {
        setError(nextError instanceof Error ? nextError.message : "Failed to send message.");
      }
    } finally {
      activeRequestRef.current = null;
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (isSending || queuedMessages.length === 0) {
      return;
    }

    const [next, ...rest] = queuedMessages;
    setQueuedMessages(rest);
    void sendMessage(next.content, next.sessionId);
  }, [isSending, queuedMessages]);

  const stopSending = () => {
    activeRequestRef.current?.abort();
  };

  const uploadDocuments = async (files: FileList | File[]) => {
    if (!bootstrap || !files.length) {
      return;
    }

    try {
      setIsUploading(true);
      setError(null);

      for (const file of Array.from(files) as UploadableFile[]) {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("title", file.webkitRelativePath?.trim() || file.name);
        formData.set("ingestionMode", "standard");

        await parseJson(
          await fetch(
            `/api/v1/workspaces/${bootstrap.workspaceId}/collections/${bootstrap.collectionId}/documents/upload`,
            {
              method: "POST",
              body: formData
            }
          )
        );
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to upload document.");
    } finally {
      setIsUploading(false);
    }
  };

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    bootstrap,
    isBootstrapping,
    isSending,
    isUploading,
    queuedMessages,
    error,
    createNewSession,
    deleteSession,
    updateSessionTitle,
    sendMessage,
    stopSending,
    setSessionMessages,
    uploadDocuments
  };
}
