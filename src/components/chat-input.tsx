"use client";

import { useEffect, useRef } from "react";

type ChatInputProps = {
  input: string;
  isSending: boolean;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
};

export function ChatInput({
  input,
  isSending,
  onInputChange,
  onSendMessage
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
        <button
          className="composer-send-button"
          type="submit"
          disabled={isSending || !input.trim()}
          aria-label={isSending ? "Sending" : "Send message"}
        >
          {isSending ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M8 8h8v8H8z"
                fill="currentColor"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </form>
  );
}
