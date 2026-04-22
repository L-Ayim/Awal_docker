import { useEffect, useRef } from "react";
import type { ChatCitation, ChatMessage, ChatSession } from "@/types/chat";

type ChatMessageListProps = {
  session: ChatSession | null;
  isBootstrapping: boolean;
  error: string | null;
};

function ReferenceFiles({ citations }: { citations: ChatCitation[] }) {
  const files = citations.reduce<Array<ChatCitation["document"]>>((acc, citation) => {
    if (acc.some((file) => file.id === citation.document.id)) {
      return acc;
    }

    acc.push(citation.document);
    return acc;
  }, []);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="chat-files">
      <span className="chat-section-label">Referenced Files</span>
      <div className="chat-file-list">
        {files.map((file) => (
          <a
            key={file.id}
            className="chat-file-card"
            href={`/api/v1/documents/${file.id}/download`}
            target="_blank"
            rel="noreferrer"
          >
            <strong>{file.title}</strong>
            <span>Download source</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const citations = message.answerRecord?.citations ?? [];

  return (
    <article className={`chat-bubble ${message.role}`}>
      <span className="chat-role">
        {message.role === "assistant"
          ? "Awal"
          : message.role === "user"
            ? "You"
            : "System"}
      </span>
      <p className="chat-message-content">{message.content}</p>
      {message.role === "assistant" && citations.length > 0 ? (
        <div className="chat-references">
          <span className="chat-section-label">References</span>
          <div className="chat-reference-list">
            {citations.map((citation) => (
              <article key={`${message.id}-${citation.citationOrder}`} className="chat-reference-card">
                <div className="chat-reference-meta">
                  <strong>
                    [{citation.citationOrder}] {citation.document.title}
                  </strong>
                  <span>{citation.locationLabel}</span>
                </div>
                <p>{citation.quotedText}</p>
              </article>
            ))}
          </div>
          <ReferenceFiles citations={citations} />
        </div>
      ) : null}
    </article>
  );
}

export function ChatMessageList({
  session,
  isBootstrapping,
  error
}: ChatMessageListProps) {
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [session?.id, session?.messages.length]);

  if (isBootstrapping) {
    return (
      <div className="chat-thread empty">
        <p>Connecting Awal to Fly and Neon...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="chat-thread empty">
        <p>No session selected.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-thread empty">
        <p>{error}</p>
      </div>
    );
  }

  if (session.messages.length === 0) {
    return (
      <div className="chat-thread empty">
        <p>Start the conversation.</p>
      </div>
    );
  }

  return (
    <div ref={threadRef} className="chat-thread">
      {session.messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}
