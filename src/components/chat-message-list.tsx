import { Check, ChevronDown, ChevronUp, Copy, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatCitation, ChatMessage, ChatSession } from "@/types/chat";

type ChatMessageListProps = {
  session: ChatSession | null;
  isBootstrapping: boolean;
  error: string | null;
  isSending: boolean;
  onResendMessage: (content: string) => void;
};

function stripExtension(title: string) {
  return title.replace(/\.[^.]+$/, "");
}

function formatCitationLabel(citation: ChatCitation) {
  const doc = stripExtension(citation.document.title);
  const page =
    citation.pageStart !== null
      ? citation.pageEnd !== null && citation.pageEnd !== citation.pageStart
        ? `pp. ${citation.pageStart}-${citation.pageEnd}`
        : `p. ${citation.pageStart}`
      : null;
  const lines =
    citation.lineStart !== null
      ? citation.lineEnd !== null && citation.lineEnd !== citation.lineStart
        ? `lines ${citation.lineStart}-${citation.lineEnd}`
        : `line ${citation.lineStart}`
      : null;
  const paragraph =
    !lines && citation.paragraphStart !== null
      ? citation.paragraphEnd !== null && citation.paragraphEnd !== citation.paragraphStart
        ? `paras. ${citation.paragraphStart}-${citation.paragraphEnd}`
        : `para. ${citation.paragraphStart}`
      : null;

  return [doc, page, lines, paragraph].filter(Boolean).join(" - ");
}

function cleanContent(content: string) {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*!--[\s\S]*?--\s*>/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function renderMessageContent(content: string) {
  const blocks = cleanContent(content)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, index) => {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);

    const isBulletBlock = lines.every((line) => line.trimStart().startsWith("- "));

    if (isBulletBlock) {
      return (
        <ul key={`block-${index}`} className="chat-message-list-block">
          {lines.map((line, lineIndex) => (
            <li key={`line-${lineIndex}`}>{line.trimStart().slice(2)}</li>
          ))}
        </ul>
      );
    }

    return <p key={`block-${index}`}>{block}</p>;
  });
}

function CitationChips({
  citations,
  activeCitationOrder,
  onToggleCitation
}: {
  citations: ChatCitation[];
  activeCitationOrder: number | null;
  onToggleCitation: (order: number) => void;
}) {
  return (
    <div className="chat-inline-citations">
      {citations.map((citation) => {
        const active = citation.citationOrder === activeCitationOrder;

        return (
          <button
            key={citation.citationOrder}
            type="button"
            className={`chat-citation-chip ${active ? "active" : ""}`}
            onClick={() => onToggleCitation(citation.citationOrder)}
            aria-expanded={active}
          >
            <span className="chat-citation-order">{citation.citationOrder}</span>
            <span>{formatCitationLabel(citation)}</span>
          </button>
        );
      })}
    </div>
  );
}

function CitationPreview({ citation }: { citation: ChatCitation }) {
  const detailLocation = [
    citation.pageStart !== null
      ? citation.pageEnd !== null && citation.pageEnd !== citation.pageStart
        ? `Pages ${citation.pageStart}-${citation.pageEnd}`
        : `Page ${citation.pageStart}`
      : null,
    citation.lineStart !== null
      ? citation.lineEnd !== null && citation.lineEnd !== citation.lineStart
        ? `lines ${citation.lineStart}-${citation.lineEnd}`
        : `line ${citation.lineStart}`
      : null,
    citation.lineStart === null && citation.paragraphStart !== null
      ? citation.paragraphEnd !== null && citation.paragraphEnd !== citation.paragraphStart
        ? `paragraphs ${citation.paragraphStart}-${citation.paragraphEnd}`
        : `paragraph ${citation.paragraphStart}`
      : null
  ]
    .filter(Boolean)
    .join(" - ");

  return (
    <div className="chat-citation-preview">
      <div className="chat-reference-meta">
        <strong>{stripExtension(citation.document.title)}</strong>
        {detailLocation || citation.locationLabel ? (
          <span>{detailLocation || citation.locationLabel}</span>
        ) : null}
      </div>
      <p>{cleanContent(citation.quotedText)}</p>
    </div>
  );
}

function MessageBubble({
  message,
  isSending,
  onResendMessage
}: {
  message: ChatMessage;
  isSending: boolean;
  onResendMessage: (content: string) => void;
}) {
  const isCasualAssistantReply =
    message.role === "assistant" &&
    /\b(hi|hello|thank you|thanks|how can i assist|how can i help|i'?m good)\b/i.test(message.content) &&
    !/\b(policy|procedure|standard|document|evidence|omni|omnibsic|bank|compliance|risk|security)\b/i.test(
      message.content
    );
  const citations = isCasualAssistantReply ? [] : message.answerRecord?.citations ?? [];
  const [activeCitationOrder, setActiveCitationOrder] = useState<number | null>(null);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const isPendingAssistant =
    message.role === "assistant" &&
    (message.status === "sending" || message.status === "streaming");

  const activeCitation = useMemo(
    () => citations.find((citation) => citation.citationOrder === activeCitationOrder) ?? null,
    [activeCitationOrder, citations]
  );

  useEffect(() => {
    if (citations.length === 0) {
      setActiveCitationOrder(null);
      return;
    }

    if (
      activeCitationOrder !== null &&
      !citations.some((citation) => citation.citationOrder === activeCitationOrder)
    ) {
      setActiveCitationOrder(null);
    }
  }, [activeCitationOrder, citations]);

  useEffect(() => {
    if (!isEditing) {
      setEditDraft(message.content);
    }
  }, [isEditing, message.content]);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(cleanContent(message.content));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const resendEditedMessage = () => {
    const nextContent = editDraft.trim();

    if (!nextContent || isSending) {
      return;
    }

    setIsEditing(false);
    onResendMessage(nextContent);
  };

  return (
    <article
      className={`chat-bubble ${message.role}`}
      data-status={message.status ?? "complete"}
    >
      <div className="chat-bubble-header">
        <span className="chat-role">
          {message.role === "assistant" ? "Awal" : message.role === "user" ? "You" : "System"}
        </span>
        <time className="chat-message-time" dateTime={new Date(message.createdAt).toISOString()}>
          {formatMessageTime(message.createdAt)}
        </time>
      </div>
      <div className="chat-message-content">
        {isEditing ? (
          <div className="chat-edit-panel">
            <textarea
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              aria-label="Edit message"
            />
            <div className="chat-edit-actions">
              <button type="button" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
              <button type="button" onClick={resendEditedMessage} disabled={isSending || !editDraft.trim()}>
                Resend
              </button>
            </div>
          </div>
        ) : message.content ? (
          renderMessageContent(message.content)
        ) : null}
        {isPendingAssistant ? (
          <div className="chat-typing" aria-label="Awal is thinking" aria-live="polite">
            <span />
            <span />
            <span />
          </div>
        ) : null}
      </div>
      {!isEditing && message.content ? (
        <div className="chat-bubble-actions">
          <button
            type="button"
            className="chat-bubble-icon-button"
            onClick={copyMessage}
            aria-label={copied ? "Message copied" : "Copy message"}
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </button>
          {message.role === "user" ? (
            <button
              type="button"
              className="chat-bubble-icon-button"
              onClick={() => setIsEditing(true)}
              disabled={isSending}
              aria-label="Edit and resend message"
              title="Edit and resend"
            >
              <Pencil aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
      {message.role === "assistant" && citations.length > 0 ? (
        <div className="chat-references">
          <button
            className="chat-references-toggle"
            type="button"
            onClick={() => setReferencesOpen((current) => !current)}
            aria-expanded={referencesOpen}
          >
            <span>References</span>
            <span>{citations.length}</span>
            {referencesOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </button>
          {referencesOpen ? (
            <>
              <CitationChips
                citations={citations}
                activeCitationOrder={activeCitationOrder}
                onToggleCitation={(order) =>
                  setActiveCitationOrder((current) => (current === order ? null : order))
                }
              />
              {activeCitation ? <CitationPreview citation={activeCitation} /> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ChatMessageList({
  session,
  isBootstrapping,
  error,
  isSending,
  onResendMessage
}: ChatMessageListProps) {
  const threadRef = useRef<HTMLDivElement | null>(null);
  const contentSignature =
    session?.messages
      .map((message) => `${message.id}:${message.status ?? "complete"}:${message.content.length}`)
      .join("|") ?? "";

  useEffect(() => {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [session?.id, contentSignature]);

  if (isBootstrapping) {
    return (
      <div className="chat-thread empty">
        <p>Loading your chats...</p>
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
      <div className="chat-thread empty" />
    );
  }

  return (
    <div ref={threadRef} className="chat-thread">
      {session.messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isSending={isSending}
          onResendMessage={onResendMessage}
        />
      ))}
    </div>
  );
}
