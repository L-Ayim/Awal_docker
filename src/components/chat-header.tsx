import { Menu, PanelLeftOpen } from "lucide-react";

type RuntimeStatus = "asleep" | "waking" | "ready" | "stopping" | "failed";

type ChatHeaderProps = {
  title: string;
  gpuRuntime: {
    automationEnabled: boolean;
    status: RuntimeStatus;
    podId: string | null;
    podName: string | null;
    lastError: string | null;
  } | null;
  onOpenSidebar: () => void;
  isSidebarCollapsed: boolean;
  onToggleSidebarCollapsed: () => void;
};

function getRuntimeLabel(status: RuntimeStatus) {
  switch (status) {
    case "ready":
      return "Pod ready";
    case "waking":
      return "Pod starting";
    case "stopping":
      return "Pod stopping";
    case "failed":
      return "Pod failed";
    case "asleep":
    default:
      return "Pod asleep";
  }
}

export function ChatHeader({
  title,
  gpuRuntime,
  onOpenSidebar,
  isSidebarCollapsed,
  onToggleSidebarCollapsed
}: ChatHeaderProps) {
  const runtimeTitle =
    gpuRuntime?.automationEnabled === false
      ? "RunPod automation is disabled"
      : gpuRuntime?.podId
        ? `${getRuntimeLabel(gpuRuntime.status)}: ${gpuRuntime.podName || gpuRuntime.podId}`
        : gpuRuntime?.lastError || getRuntimeLabel(gpuRuntime?.status ?? "asleep");

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
        <div
          className={`runtime-status-pill ${gpuRuntime?.status ?? "unknown"}`}
          title={runtimeTitle}
          aria-label={runtimeTitle}
        >
          <span aria-hidden="true" />
          <strong>{gpuRuntime ? getRuntimeLabel(gpuRuntime.status) : "Pod unknown"}</strong>
          {gpuRuntime?.podId ? <em>{gpuRuntime.podId.slice(0, 6)}</em> : null}
        </div>
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
