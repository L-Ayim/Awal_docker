import { NextResponse } from "next/server";

export function requireGpuRuntimeAdmin(request: Request) {
  const adminKey = process.env.GPU_RUNTIME_ADMIN_KEY?.trim();

  if (!adminKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "GPU runtime admin key is not configured."
      },
      { status: 503 }
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (token !== adminKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized."
      },
      { status: 401 }
    );
  }

  return null;
}
