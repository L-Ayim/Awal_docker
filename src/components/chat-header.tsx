type ChatHeaderProps = {
  title: string;
  onOpenSidebar: () => void;
};

export function ChatHeader({
  title,
  onOpenSidebar
}: ChatHeaderProps) {
  return (
    <header className="chat-topbar">
      <div>
        <h2>{title}</h2>
      </div>
      <div className="chat-topbar-actions">
        <button
          className="mobile-sidebar-toggle"
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
