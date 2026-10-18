import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Account services are unavailable. Please try again later.", 503);
    }
    console.error("Account sign-out failed.", error);
    return jsonError("We couldn't end your session. Please try again.", 500);
  }
}