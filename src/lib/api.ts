import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json(
    {
      error: "bad_request",
      message,
      details
    },
    { status: 400 }
  );
}

export function notFound(message: string) {
  return NextResponse.json(
    {
      error: "not_found",
      message
    },
    { status: 404 }
  );
}

export function serverError(message: string) {
  return NextResponse.json(
    {
      error: "server_error",
      message
    },
    { status: 500 }
  );
}

export function validationError(error: ZodError) {
  return badRequest("Validation failed.", error.flatten());
}

