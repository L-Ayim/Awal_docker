import { Menu } from "lucide-react";

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
          <Menu aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
