import { NextResponse } from "next/server";
import { sleepGpuRuntime } from "@/lib/gpu-runtime";
import { requireGpuRuntimeAdmin } from "../auth";

export async function POST(request: Request) {
  const unauthorized = requireGpuRuntimeAdmin(request);

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const runtime = await sleepGpuRuntime();

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
