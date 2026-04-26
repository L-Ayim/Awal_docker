"use client";

import Link from "next/link";
import { Library, PanelLeftClose, Pencil, Plus, Trash2 } from "lucide-react";
import type { ChatSession } from "@/types/chat";

type ChatSidebarProps = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  editingSessionId: string | null;
  sidebarTitleDraft: string;
  isBootstrapping: boolean;
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
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
  isCollapsed,
  onClose,
  onToggleCollapsed,
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
      <aside className={`sidebar ${isOpen ? "sidebar-mobile-open" : ""} ${isCollapsed ? "sidebar-collapsed" : ""}`}>
        <div className="sidebar-brand">
          <h1>
            <span className="sidebar-brand-mark">
              <img src="/awal-logo.png" alt="Awal logo" />
            </span>
            <span className="sidebar-brand-wordmark">Awal</span>
          </h1>
          {!isCollapsed ? (
            <button
              className="sidebar-collapse-toggle"
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <button
          className="sidebar-new-chat"
          onClick={() => void onNewChat()}
          type="button"
          disabled={isBootstrapping}
          aria-label="New chat"
          title="New chat"
        >
          <Plus aria-hidden="true" />
          <span>New Chat</span>
        </button>

        <Link className="sidebar-library-link" href="/library" title="Library">
          <Library aria-hidden="true" />
          <span>Library</span>
        </Link>

        <div className="sidebar-section">
          <span className="sidebar-label">Chats</span>
          <div className="sidebar-session-list">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const avatarLabel = session.title.trim().charAt(0).toUpperCase() || "A";

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
                        title={session.title}
                      >
                        <span className="sidebar-session-avatar" aria-hidden="true">
                          {avatarLabel}
                        </span>
                        <span className="sidebar-session-copy">
                          <strong>{session.title}</strong>
                          <span>
                            {new Date(session.createdAt).toLocaleDateString()}
                          </span>
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
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      className="sidebar-icon-button delete-button"
                      type="button"
                      onClick={() => void onDeleteSession(session.id)}
                      aria-label={`Delete ${session.title}`}
                    >
                      <Trash2 aria-hidden="true" />
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
