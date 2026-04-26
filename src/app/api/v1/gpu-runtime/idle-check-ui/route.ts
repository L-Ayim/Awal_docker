import { NextResponse } from "next/server";
import { sleepGpuRuntimeIfIdle } from "@/lib/gpu-runtime";

export async function POST() {
  try {
    const result = await sleepGpuRuntimeIfIdle({ kind: "chat" });

    return NextResponse.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "gpu_runtime_idle_check_failed"
      },
      { status: 500 }
    );
  }
}
