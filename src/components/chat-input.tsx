"use client";

import { Send, Square } from "lucide-react";
import { useEffect, useRef } from "react";

type ChatInputProps = {
  input: string;
  isSending: boolean;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onStopSending: () => void;
};

export function ChatInput({
  input,
  isSending,
  onInputChange,
  onSendMessage,
  onStopSending
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
          type={isSending ? "button" : "submit"}
          disabled={!isSending && !input.trim()}
          onClick={isSending ? onStopSending : undefined}
          aria-label={isSending ? "Stop response" : "Send message"}
        >
          {isSending ? <Square aria-hidden="true" /> : <Send aria-hidden="true" />}
        </button>
      </div>
    </form>
  );
}
