import { NextResponse } from "next/server";
import { wakeGpuRuntime } from "@/lib/gpu-runtime";
import { requireGpuRuntimeAdmin } from "../auth";

export async function POST(request: Request) {
  const unauthorized = requireGpuRuntimeAdmin(request);

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const wait = new URL(request.url).searchParams.get("wait") === "1";
    const runtime = await wakeGpuRuntime({ waitForHealth: wait });

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
