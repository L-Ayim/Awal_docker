import { NextResponse } from "next/server";
import {
  getGpuRuntimeState,
  getGpuRuntimeStaticEndpoints,
  isGpuRuntimeAutomationEnabled,
  refreshGpuRuntimeState
} from "@/lib/gpu-runtime";

export async function GET() {
  try {
    const cachedRuntime = await getGpuRuntimeState();
    const cachedIngestRuntime = await getGpuRuntimeState("ingest");
    const runtime =
      cachedRuntime.status === "waking" ? await refreshGpuRuntimeState("chat") : cachedRuntime;
    const ingestRuntime =
      cachedIngestRuntime.status === "waking"
        ? await refreshGpuRuntimeState("ingest")
        : cachedIngestRuntime;

    return NextResponse.json({
      ok: true,
      automationEnabled: isGpuRuntimeAutomationEnabled(),
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
