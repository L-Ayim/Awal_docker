"use client";

import { Clock3, Send, Square } from "lucide-react";
import { useEffect, useRef } from "react";

type ChatInputProps = {
  input: string;
  isSending: boolean;
  queuedCount: number;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onStopSending: () => void;
};

export function ChatInput({
  input,
  isSending,
  queuedCount,
  onInputChange,
  onSendMessage,
  onStopSending
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasInput = input.trim().length > 0;

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
            ? hasInput
              ? "Send to queue the next message."
              : "Response is in progress."
            : null}
          {queuedCount > 0
            ? `${isSending ? " " : ""}${queuedCount} queued ${queuedCount === 1 ? "message" : "messages"}.`
            : null}
        </div>
      ) : null}
    </form>
  );
}
