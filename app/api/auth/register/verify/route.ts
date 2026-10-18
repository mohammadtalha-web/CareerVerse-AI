import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { matchesEmailVerificationCode } from "@/lib/email-verification";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { consumeLoginAttempts } from "@/lib/loginRateLimit";

const MAX_CODE_ATTEMPTS = 5;

type PendingRegistrationRow = RowDataPacket & {
  email: string;
  fullName: string;
  role: "job_seeker" | "recruiter";
  universityName: string | null;
  passwordSalt: string;
  passwordHash: string;
  challengeId: string;
  codeDigest: string;
  attemptCount: number;
  expired: number | boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function forwardedAddress(request: Request): string {
  return (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown").slice(0, 100);
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send the verification details as JSON.", 415);
  }
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > 2_048) return jsonError("The request is too large.", 413);

  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 2_048) return jsonError("The request is too large.", 413);
    body = JSON.parse(text) as unknown;
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }
  if (!isRecord(body)) return jsonError("Verification details are required.", 400);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return jsonError("Enter the email address used to sign up.", 400);
  }
  if (!/^\d{6}$/.test(code)) return jsonError("Enter the six-digit code from your email.", 400);

  const forwardedFor = forwardedAddress(request);
  try {
    const [emailLimit, networkLimit] = await consumeLoginAttempts([
      `register-verify-email:${email}`,
      ...(forwardedFor === "unknown" ? [] : [`register-verify-network:${forwardedFor}`]),
    ]);
    if (!emailLimit.allowed || (networkLimit && !networkLimit.allowed)) {
      const retryAfter = Math.max(emailLimit.retryAfterSeconds, networkLimit?.retryAfterSeconds ?? 0);
      return NextResponse.json(
        { error: "Too many verification attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
      );
    }

    const connection = await getDatabase().getConnection();
    let accountId = 0;
    let accountRole: PendingRegistrationRow["role"] = "job_seeker";
    try {
      await connection.beginTransaction();
      const [pendingRows] = await connection.execute<PendingRegistrationRow[]>(
        `SELECT email, full_name AS fullName, role, university_name AS universityName,
                password_salt AS passwordSalt, password_hash AS passwordHash,
                challenge_id AS challengeId, code_digest AS codeDigest,
                attempt_count AS attemptCount, expires_at <= UTC_TIMESTAMP(3) AS expired
         FROM pending_email_registrations
         WHERE email = ? LIMIT 1 FOR UPDATE`,
        [email],
      );
      const pending = pendingRows[0];
      if (!pending) {
        await connection.rollback();
        return jsonError("No signup is waiting for verification. Request a new code.", 404);
      }
      if (Boolean(pending.expired)) {
        await connection.rollback();
        return jsonError("That verification code has expired. Request a new one.", 410);
      }
      if (Number(pending.attemptCount) >= MAX_CODE_ATTEMPTS) {
        await connection.rollback();
        return jsonError("Too many incorrect codes. Request a new code to continue.", 429);
      }
      if (!matchesEmailVerificationCode(email, pending.challengeId, code, pending.codeDigest)) {
        await connection.execute(
          "UPDATE pending_email_registrations SET attempt_count = attempt_count + 1 WHERE email = ?",
          [email],
        );
        const attemptsLeft = MAX_CODE_ATTEMPTS - Number(pending.attemptCount) - 1;
        await connection.commit();
        return jsonError(
          attemptsLeft > 0
            ? `That code is not correct. You have ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`
            : "Too many incorrect codes. Request a new code to continue.",
          attemptsLeft > 0 ? 400 : 429,
        );
      }

      const [existingUsers] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE",
        [email],
      );
      if (existingUsers[0]) {
        await connection.rollback();
        return jsonError("An account already exists for that email address. Log in instead.", 409);
      }

      let universityId: number | null = null;
      if (pending.universityName) {
        const [universityResult] = await connection.execute<ResultSetHeader>(
          "INSERT INTO universities (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
          [pending.universityName],
        );
        universityId = Number(universityResult.insertId);
      }
      const [userResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users
           (email, full_name, role, university_id, password_salt, password_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          pending.email,
          pending.fullName,
          pending.role,
          universityId,
          pending.passwordSalt,
          pending.passwordHash,
        ],
      );
      accountId = Number(userResult.insertId);
      accountRole = pending.role;
      if (!Number.isSafeInteger(accountId) || accountId < 1) {
        throw new Error("Verified account creation did not return a valid identifier.");
      }
      await connection.execute("DELETE FROM pending_email_registrations WHERE email = ?", [email]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    try {
      await createSession(accountId);
    } catch (error) {
      console.error("Verified account could not be signed in.", error);
      return jsonError("Your email is verified, but we couldn't sign you in. Please log in with your new account.", 503);
    }
    return NextResponse.json({
      account: { email, role: accountRole },
      verified: true,
    });
  } catch (error) {
    if (isDuplicateEntry(error)) {
      return jsonError("An account already exists for that email address. Log in instead.", 409);
    }
    if (error instanceof Error && error.message.startsWith("Missing required environment variable: SMTP_PASSWORD")) {
      console.error("Email verification code signing is not configured.", error);
      return jsonError("Email verification is not configured. Check the SMTP settings and try again.", 503);
    }
    if (isDatabaseUnavailable(error)) {
      console.error("Email verification database setup is incomplete.", error);
      return jsonError("Account services are unavailable. Check the database setup and schema.", 503);
    }
    console.error("Email code verification failed.", error);
    return jsonError("We couldn't verify your code. Please try again.", 500);
  }
}
