"use client";

import { useMemo, useState } from "react";
import { ChatHeader } from "@/components/chat-header";
import { ChatInput } from "@/components/chat-input";
import { ChatMessageList } from "@/components/chat-message-list";
import { ChatSidebar } from "@/components/chat-sidebar";
import { useSessions } from "@/hooks/useSessions";

export default function HomePage() {
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    isBootstrapping,
    isSending,
    error,
    createNewSession,
    deleteSession,
    updateSessionTitle,
    sendMessage
  } = useSessions();
  const [input, setInput] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sidebarTitleDraft, setSidebarTitleDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null,
    [sessions, activeSessionId]
  );

  const activeTitle = activeSession?.title ?? "New chat";

  async function handleSendMessage() {
    if (!activeSession || !input.trim() || isSending) return;
    const content = input.trim();
    setInput("");
    await sendMessage(content);
  }

  return (
    <main className="app-shell">
      <section className="sidebar-shell">
        <ChatSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          editingSessionId={editingSessionId}
          sidebarTitleDraft={sidebarTitleDraft}
          onNewChat={createNewSession}
          onSelectSession={setActiveSessionId}
          isBootstrapping={isBootstrapping}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onStartEditing={(id, title) => {
            setEditingSessionId(id);
            setSidebarTitleDraft(title);
          }}
          onDeleteSession={deleteSession}
          onSidebarTitleDraftChange={setSidebarTitleDraft}
          onCommitEdit={(id, title) => {
            updateSessionTitle(id, title);
            setEditingSessionId(null);
          }}
        />

        <section className="chat-shell">
          <ChatHeader
            title={activeTitle}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
          <ChatMessageList
            session={activeSession}
            isBootstrapping={isBootstrapping}
            error={error}
          />
          <ChatInput
            input={input}
            isSending={isSending}
            onInputChange={setInput}
            onSendMessage={handleSendMessage}
          />
        </section>
      </section>
    </main>
  );
}
