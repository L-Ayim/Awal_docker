import { NextResponse } from "next/server";
import {
  getGpuRuntimeState,
  getGpuRuntimeStaticEndpoints,
  isGpuRuntimeAutomationEnabled
} from "@/lib/gpu-runtime";

export async function GET() {
  try {
    const runtime = await getGpuRuntimeState();

    return NextResponse.json({
      ok: true,
      automationEnabled: isGpuRuntimeAutomationEnabled(),
      staticEndpoints: getGpuRuntimeStaticEndpoints(),
      runtime
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
