import { NextResponse } from "next/server";
import { sleepGpuRuntime } from "@/lib/gpu-runtime";

function runtimeKind(request: Request) {
  return new URL(request.url).searchParams.get("kind") === "ingest" ? "ingest" : "chat";
}

export async function POST(request: Request) {
  try {
    const runtime = await sleepGpuRuntime({ kind: runtimeKind(request) });

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
