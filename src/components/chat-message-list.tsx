import type { ChatMessage, ChatSession } from "@/types/chat";

type ChatMessageListProps = {
  session: ChatSession | null;
  isBootstrapping: boolean;
  error: string | null;
};

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`chat-bubble ${message.role}`}>
      <span className="chat-role">
        {message.role === "assistant"
          ? "Awal"
          : message.role === "user"
            ? "You"
            : "System"}
      </span>
      <p>{message.content}</p>
    </article>
  );
}

export function ChatMessageList({
  session,
  isBootstrapping,
  error
}: ChatMessageListProps) {
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
    <div className="chat-thread">
      {session.messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}
