import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const isRoot = request.nextUrl.pathname === "/";
  const isUploadHost = request.headers.get("host")?.startsWith("awal-upload.") ?? false;
  const uploadMode = process.env.AWAL_APP_MODE === "upload";

  if (isRoot && (isUploadHost || uploadMode)) {
    const url = request.nextUrl.clone();
    url.pathname = "/library";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"]
};
