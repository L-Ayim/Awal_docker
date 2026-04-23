"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderUp, Pencil, Plus, Trash2, Upload } from "lucide-react";
import type { ChatSession } from "@/types/chat";

type ChatSidebarProps = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  editingSessionId: string | null;
  sidebarTitleDraft: string;
  isBootstrapping: boolean;
  isUploading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void | Promise<void>;
  onUploadDocuments: (files: FileList | File[]) => void | Promise<void>;
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
  isUploading,
  isOpen,
  onClose,
  onNewChat,
  onUploadDocuments,
  onSelectSession,
  onStartEditing,
  onDeleteSession,
  onSidebarTitleDraftChange,
  onCommitEdit
}: ChatSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);

  useEffect(() => {
    if (!uploadMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!uploadMenuRef.current?.contains(event.target as Node)) {
        setUploadMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [uploadMenuOpen]);

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

        <div className="sidebar-upload-menu" ref={uploadMenuRef}>
          <button
            className="sidebar-upload"
            onClick={() => setUploadMenuOpen((current) => !current)}
            type="button"
            disabled={isUploading}
            aria-label="Open upload options"
            aria-expanded={uploadMenuOpen}
          >
            <Upload aria-hidden="true" />
            <span>{isUploading ? "Uploading..." : "Upload"}</span>
            <ChevronDown
              aria-hidden="true"
              className={uploadMenuOpen ? "sidebar-upload-chevron open" : "sidebar-upload-chevron"}
            />
          </button>

          {uploadMenuOpen ? (
            <div className="sidebar-upload-dropdown" role="menu" aria-label="Upload options">
              <button
                className="sidebar-upload-option"
                onClick={() => {
                  setUploadMenuOpen(false);
                  fileInputRef.current?.click();
                }}
                type="button"
                disabled={isUploading}
                role="menuitem"
              >
                <Upload aria-hidden="true" />
                <span>Documents</span>
              </button>
              <button
                className="sidebar-upload-option"
                onClick={() => {
                  setUploadMenuOpen(false);
                  folderInputRef.current?.click();
                }}
                type="button"
                disabled={isUploading}
                role="menuitem"
              >
                <FolderUp aria-hidden="true" />
                <span>Folder</span>
              </button>
            </div>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) {
              void onUploadDocuments(files);
            }
            event.currentTarget.value = "";
          }}
        />

        <input
          ref={folderInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) {
              void onUploadDocuments(files);
            }
            event.currentTarget.value = "";
          }}
          {...({
            webkitdirectory: "",
            directory: ""
          } as Record<string, string>)}
        />

        <button
          className="sidebar-new-chat"
          onClick={() => void onNewChat()}
          type="button"
          disabled={isBootstrapping}
          aria-label="New chat"
        >
          <Plus aria-hidden="true" />
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
