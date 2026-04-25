import { Menu, PanelLeftOpen } from "lucide-react";

type ChatHeaderProps = {
  title: string;
  onOpenSidebar: () => void;
  isSidebarCollapsed: boolean;
  onToggleSidebarCollapsed: () => void;
};

export function ChatHeader({
  title,
  onOpenSidebar,
  isSidebarCollapsed,
  onToggleSidebarCollapsed
}: ChatHeaderProps) {
  return (
    <header className="chat-topbar">
      <div className="chat-topbar-title">
        {isSidebarCollapsed ? (
          <button
            className="desktop-sidebar-toggle"
            type="button"
            onClick={onToggleSidebarCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeftOpen aria-hidden="true" />
          </button>
        ) : null}
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
