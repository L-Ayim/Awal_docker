import { NextResponse } from "next/server";
import { wakeGpuRuntime } from "@/lib/gpu-runtime";
import { requireGpuRuntimeAdmin } from "../auth";

export async function POST(request: Request) {
  const unauthorized = requireGpuRuntimeAdmin(request);

  if (unauthorized) {
    return unauthorized;
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const wait = searchParams.get("wait") === "1";
    const kind = searchParams.get("kind") === "ingest" ? "ingest" : "chat";
    const runtime = await wakeGpuRuntime({ waitForHealth: wait, kind });

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
