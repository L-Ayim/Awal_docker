import { NextResponse } from "next/server";
import { sleepGpuRuntimeIfIdle } from "@/lib/gpu-runtime";
import { requireGpuRuntimeAdmin } from "../auth";

export async function POST(request: Request) {
  const unauthorized = requireGpuRuntimeAdmin(request);

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const result = await sleepGpuRuntimeIfIdle();

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
