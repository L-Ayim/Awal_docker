import { NextResponse } from "next/server";
import { sleepGpuRuntimeIfIdle } from "@/lib/gpu-runtime";

function runtimeKind(request: Request) {
  return new URL(request.url).searchParams.get("kind") === "ingest" ? "ingest" : "chat";
}

export async function POST(request: Request) {
  try {
    const result = await sleepGpuRuntimeIfIdle({ kind: runtimeKind(request) });

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
