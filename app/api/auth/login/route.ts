import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { createSession, verifyPassword } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { clearLoginAttempts, consumeLoginAttempts } from "@/lib/loginRateLimit";

type CredentialRow = RowDataPacket & {
  id: number;
  email: string;
  fullName: string;
  passwordSalt: string;
  passwordHash: string;
  role: "job_seeker" | "recruiter" | "admin";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send login details as JSON.", 415);
  }

  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > 8_192) return jsonError("The request is too large.", 413);
  let text: string;
  try {
    text = await request.text();
  } catch {
    return jsonError("The request body could not be read.", 400);
  }
  if (Buffer.byteLength(text, "utf8") > 8_192) return jsonError("The request is too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }
  if (!isRecord(body)) return jsonError("Login details are required.", 400);

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length > 128) {
    return jsonError("Enter a valid email and password.", 400);
  }

  const forwardedFor = (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown").slice(0, 100);
  try {
    const [emailLimit, networkLimit] = await consumeLoginAttempts([
      `email:${email}`,
      ...(forwardedFor === "unknown" ? [] : [`network:${forwardedFor}`]),
    ]);
    if (!emailLimit.allowed || (networkLimit && !networkLimit.allowed)) {
      const retryAfter = Math.max(
        emailLimit.retryAfterSeconds,
        networkLimit?.retryAfterSeconds ?? 0,
      );
      return NextResponse.json(
        { error: "Too many sign-in attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
      );
    }

    const [rows] = await getDatabase().execute<CredentialRow[]>(
      `SELECT id, email, full_name AS fullName, password_salt AS passwordSalt,
              password_hash AS passwordHash, role
       FROM users WHERE email = ? AND is_active = TRUE LIMIT 1`,
      [email],
    );
    const account = rows[0];
    const passwordMatches = account
      ? await verifyPassword(password, { salt: account.passwordSalt, hash: account.passwordHash })
      : false;

    if (!account || !passwordMatches) {
      return jsonError("Email or password is incorrect.", 401);
    }

    await clearLoginAttempts(
      `email:${email}`,
      ...(forwardedFor === "unknown" ? [] : [`network:${forwardedFor}`]),
    );
    await createSession(account.id);
    return NextResponse.json({
      account: { email: account.email, fullName: account.fullName, role: account.role },
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Account services are unavailable. Check the database setup and schema.", 503);
    }
    console.error("Account sign-in failed.", error);
    return jsonError("We couldn't sign you in. Please try again.", 500);
  }
}