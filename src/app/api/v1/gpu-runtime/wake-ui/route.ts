import { NextResponse } from "next/server";
import { wakeGpuRuntime } from "@/lib/gpu-runtime";

export async function POST() {
  try {
    const runtime = await wakeGpuRuntime({ waitForHealth: false, kind: "chat" });

    return NextResponse.json({
      ok: true,
      runtime
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "gpu_runtime_wake_failed"
      },
      { status: 500 }
    );
  }
}
