"use client";

import { Clock3, Send, Square, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

type QueuedComposerMessage = {
  id: string;
  content: string;
};

type ChatInputProps = {
  input: string;
  isSending: boolean;
  gpuRuntime: {
    automationEnabled: boolean;
    status: "asleep" | "waking" | "ready" | "stopping" | "failed";
    lastError: string | null;
  } | null;
  queuedMessages: QueuedComposerMessage[];
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onStopSending: () => void;
  onQueuedMessageChange: (id: string, content: string) => void;
  onDeleteQueuedMessage: (id: string) => void;
};

export function ChatInput({
  input,
  isSending,
  gpuRuntime,
  queuedMessages,
  onInputChange,
  onSendMessage,
  onStopSending,
  onQueuedMessageChange,
  onDeleteQueuedMessage
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasInput = input.trim().length > 0;
  const queuedCount = queuedMessages.length;
  const runtimeStatus =
    isSending && gpuRuntime?.automationEnabled
      ? gpuRuntime.status === "asleep" || gpuRuntime.status === "waking"
        ? "Model is waking up. The first answer can take several minutes."
        : gpuRuntime.status === "failed"
          ? "Model startup needs attention."
          : null
      : null;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [input]);

  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSendMessage();
      }}
      >
      {queuedMessages.length > 0 ? (
        <div className="composer-queue" aria-live="polite">
          <div className="composer-queue-header">
            <div>
              <span>Queued messages</span>
              <p>Review, edit, or delete each message before Awal sends it.</p>
            </div>
            <span>{queuedCount}</span>
          </div>
          {queuedMessages.map((message, index) => (
            <div className="composer-queue-item" key={message.id}>
              <span className="composer-queue-number">{index + 1}</span>
              <label className="composer-queue-editor">
                <span>
                  {index === 0 ? "Next up" : `Queued ${index + 1}`}
                </span>
                <textarea
                  value={message.content}
                  onChange={(event) => onQueuedMessageChange(message.id, event.target.value)}
                  aria-label={`Edit queued message ${index + 1}`}
                  placeholder="Edit this queued message..."
                  rows={1}
                />
              </label>
              <button
                type="button"
                className="composer-queue-delete"
                onClick={() => onDeleteQueuedMessage(message.id)}
                aria-label={`Delete queued message ${index + 1}`}
                title="Delete queued message"
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="composer-field">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder=""
          aria-label="Ask about a document"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSendMessage();
            }
          }}
        />
        <div className="composer-actions">
          {isSending ? (
            <button
              className="composer-stop-button"
              type="button"
              onClick={onStopSending}
              aria-label="Stop response"
            >
              <Square aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="composer-send-button"
            type="submit"
            disabled={!hasInput}
            aria-label={isSending ? "Queue message" : "Send message"}
          >
            {isSending ? <Clock3 aria-hidden="true" /> : <Send aria-hidden="true" />}
          </button>
        </div>
      </div>
      {isSending || queuedCount > 0 ? (
        <div className="composer-status" aria-live="polite">
          {isSending
            ? runtimeStatus ||
              (hasInput
              ? "Send to queue the next message."
                : "Response is in progress.")
            : null}
          {queuedCount > 0
            ? `${isSending ? " " : ""}${queuedCount} queued ${queuedCount === 1 ? "message" : "messages"}.`
            : null}
        </div>
      ) : null}
    </form>
  );
}
