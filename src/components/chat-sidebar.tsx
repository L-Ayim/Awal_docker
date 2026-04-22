"use client";

import type { ChatSession } from "@/types/chat";

type ChatSidebarProps = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  editingSessionId: string | null;
  sidebarTitleDraft: string;
  isBootstrapping: boolean;
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void | Promise<void>;
  onSelectSession: (id: string) => void;
  onStartEditing: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void | Promise<void>;
  onSidebarTitleDraftChange: (value: string) => void;
  onCommitEdit: (id: string, title: string) => void | Promise<void>;
};

export function ChatSidebar({
  sessions,
  activeSessionId,
  editingSessionId,
  sidebarTitleDraft,
  isBootstrapping,
  isOpen,
  onClose,
  onNewChat,
  onSelectSession,
  onStartEditing,
  onDeleteSession,
  onSidebarTitleDraftChange,
  onCommitEdit
}: ChatSidebarProps) {
  return (
    <>
      {isOpen ? <button className="mobile-sidebar-overlay" onClick={onClose} aria-label="Close sidebar" /> : null}
      <aside className={`sidebar ${isOpen ? "sidebar-mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <h1>
            <span className="sidebar-brand-mark">
              <img src="/awal-logo.png" alt="Awal logo" />
            </span>
            <span className="sidebar-brand-wordmark">Awal</span>
          </h1>
        </div>

        <button
          className="sidebar-new-chat"
          onClick={() => void onNewChat()}
          type="button"
          disabled={isBootstrapping}
          aria-label="New chat"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span>New Chat</span>
        </button>

        <div className="sidebar-section">
          <span className="sidebar-label">Chats</span>
          <div className="sidebar-session-list">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;

              return (
                <div
                  key={session.id}
                  className={`sidebar-item ${isActive ? "active" : ""}`}
                >
                  <div className="sidebar-item-main">
                    {editingSessionId === session.id ? (
                      <input
                        autoFocus
                        value={sidebarTitleDraft}
                        onChange={(event) =>
                          onSidebarTitleDraftChange(event.target.value)
                        }
                        onBlur={() =>
                          onCommitEdit(session.id, sidebarTitleDraft || "New chat")
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            onCommitEdit(
                              session.id,
                              sidebarTitleDraft || "New chat"
                            );
                          }
                        }}
                        className="sidebar-input"
                      />
                    ) : (
                      <button
                        className="sidebar-session-button"
                        type="button"
                        onClick={() => {
                          onSelectSession(session.id);
                          onClose();
                        }}
                      >
                        <strong>{session.title}</strong>
                        <span>
                          {new Date(session.createdAt).toLocaleDateString()}
                        </span>
                      </button>
                    )}
                  </div>

                  <div className="sidebar-actions">
                    <button
                      className="sidebar-icon-button"
                      type="button"
                      onClick={() => onStartEditing(session.id, session.title)}
                      aria-label={`Edit ${session.title}`}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      className="sidebar-icon-button"
                      type="button"
                      onClick={() => void onDeleteSession(session.id)}
                      aria-label={`Delete ${session.title}`}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M6 7h12M9 7V5h6v2m-7 3v7m4-7v7m4-7v7M8 7l1 12h6l1-12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
}
