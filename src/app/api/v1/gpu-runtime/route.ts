import { NextResponse } from "next/server";
import {
  getGpuRuntimeState,
  getGpuRuntimeStaticEndpoints,
  isGpuRuntimeAutomationEnabled,
  refreshGpuRuntimeState
} from "@/lib/gpu-runtime";

function numberEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET() {
  try {
    const cachedRuntime = await getGpuRuntimeState();
    const cachedIngestRuntime = await getGpuRuntimeState("ingest");
    const shouldRefresh = (status: string) => status === "waking" || status === "ready";
    const runtime =
      shouldRefresh(cachedRuntime.status) ? await refreshGpuRuntimeState("chat") : cachedRuntime;
    const ingestRuntime =
      shouldRefresh(cachedIngestRuntime.status)
        ? await refreshGpuRuntimeState("ingest")
        : cachedIngestRuntime;

    return NextResponse.json({
      ok: true,
      automationEnabled: isGpuRuntimeAutomationEnabled(),
      idleMinutes: numberEnv("RUNPOD_IDLE_MINUTES", 45),
      ingestIdleMinutes: numberEnv(
        "RUNPOD_INGEST_IDLE_MINUTES",
        numberEnv("RUNPOD_IDLE_MINUTES", 45)
      ),
      staticEndpoints: getGpuRuntimeStaticEndpoints(),
      runtime,
      runtimes: {
        chat: runtime,
        ingest: ingestRuntime
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "gpu_runtime_status_failed"
      },
      { status: 500 }
    );
  }
}
