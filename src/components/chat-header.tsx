import { Menu, PanelLeftOpen, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

type RuntimeStatus = "asleep" | "waking" | "ready" | "stopping" | "failed";

type ChatHeaderProps = {
  title: string;
  gpuRuntime: {
    automationEnabled: boolean;
    status: RuntimeStatus;
    podId: string | null;
    podName: string | null;
    lastRequestAt: string | null;
    lastHealthAt: string | null;
    idleMinutes: number;
    lastError: string | null;
  } | null;
  isWakingRuntime: boolean;
  onWakeRuntime: () => void;
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

function formatRemaining(ms: number) {
  if (ms <= 0) {
    return "sleep due";
  }

  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export function ChatHeader({
  title,
  gpuRuntime,
  isWakingRuntime,
  onWakeRuntime,
  onOpenSidebar,
  isSidebarCollapsed,
  onToggleSidebarCollapsed
}: ChatHeaderProps) {
  const [now, setNow] = useState(() => Date.now());
  const sleepAt =
    gpuRuntime?.lastRequestAt && gpuRuntime.status === "ready"
      ? new Date(gpuRuntime.lastRequestAt).getTime() + gpuRuntime.idleMinutes * 60 * 1000
      : null;
  const remainingMs = sleepAt ? sleepAt - now : null;
  const idleProgress =
    remainingMs !== null && gpuRuntime
      ? Math.max(
          0,
          Math.min(100, 100 - (remainingMs / (gpuRuntime.idleMinutes * 60 * 1000)) * 100)
        )
      : 0;
  const canWake =
    Boolean(gpuRuntime?.automationEnabled) &&
    !isWakingRuntime &&
    (gpuRuntime?.status === "asleep" || gpuRuntime?.status === "failed");
  const runtimeTitle =
    gpuRuntime?.automationEnabled === false
      ? "RunPod automation is disabled"
      : gpuRuntime?.podId
        ? `${getRuntimeLabel(gpuRuntime.status)}: ${gpuRuntime.podName || gpuRuntime.podId}${
            remainingMs !== null ? `. Sleeps in ${formatRemaining(remainingMs)}.` : ""
          }`
        : gpuRuntime?.lastError || getRuntimeLabel(gpuRuntime?.status ?? "asleep");

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 30000);

    return () => window.clearInterval(intervalId);
  }, []);

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
          <div className="runtime-status-copy">
            <strong>{gpuRuntime ? getRuntimeLabel(gpuRuntime.status) : "Pod unknown"}</strong>
            <small>
              {remainingMs !== null
                ? `Sleeps in ${formatRemaining(remainingMs)}`
                : gpuRuntime?.podId
                  ? gpuRuntime.podId.slice(0, 6)
                  : "No pod"}
            </small>
          </div>
          {remainingMs !== null ? (
            <div className="runtime-idle-timeline" aria-hidden="true">
              <span style={{ width: `${idleProgress}%` }} />
            </div>
          ) : null}
          <button
            type="button"
            className="runtime-wake-button"
            onClick={onWakeRuntime}
            disabled={!canWake}
            aria-label="Start RunPod runtime"
            title="Start RunPod runtime"
          >
            <RotateCw aria-hidden="true" />
          </button>
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
