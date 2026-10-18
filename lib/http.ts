import { NextResponse } from "next/server";

export function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.message.startsWith("Missing required environment variable:") ||
    error.message.startsWith("DB_PORT must be") ||
    "code" in error &&
      typeof error.code === "string" &&
      [
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "ENOTFOUND",
        "ER_ACCESS_DENIED_ERROR",
        "ER_BAD_DB_ERROR",
        "ER_NO_SUCH_TABLE",
        "PROTOCOL_CONNECTION_LOST",
      ].includes(error.code)
  );
}
