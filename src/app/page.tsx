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
    isUploading,
    gpuRuntime,
    queuedMessages,
    error,
    createNewSession,
    deleteSession,
    updateSessionTitle,
    sendMessage,
    stopSending,
    updateQueuedMessage,
    deleteQueuedMessage,
    uploadDocuments
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
  const activeQueuedMessages = queuedMessages.filter((message) => message.sessionId === activeSessionId);

  async function handleSendMessage() {
    if (!activeSession || !input.trim()) return;
    const content = input.trim();
    setInput("");
    void sendMessage(content);
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
          onUploadDocuments={uploadDocuments}
          onSidebarTitleDraftChange={setSidebarTitleDraft}
          onCommitEdit={(id, title) => {
            updateSessionTitle(id, title);
            setEditingSessionId(null);
          }}
          isUploading={isUploading}
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
            isSending={isSending}
            onResendMessage={(content) => void sendMessage(content)}
          />
          <ChatInput
            input={input}
            isSending={isSending}
            gpuRuntime={gpuRuntime}
            queuedMessages={activeQueuedMessages}
            onInputChange={setInput}
            onSendMessage={handleSendMessage}
            onStopSending={stopSending}
            onQueuedMessageChange={updateQueuedMessage}
            onDeleteQueuedMessage={deleteQueuedMessage}
          />
        </section>
      </section>
    </main>
  );
}
