import { NextResponse } from "next/server";
import { sleepGpuRuntime } from "@/lib/gpu-runtime";

export async function POST() {
  try {
    const runtime = await sleepGpuRuntime({ kind: "chat" });

    return NextResponse.json({
      ok: true,
      runtime
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "gpu_runtime_sleep_failed"
      },
      { status: 500 }
    );
  }
}
