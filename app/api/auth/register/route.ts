import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import {
  cleanupExpiredEmailRegistrations,
  createEmailVerificationCode,
  EmailDeliveryError,
  getSmtpConfiguration,
  sendEmailVerificationCode,
} from "@/lib/email-verification";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { consumeLoginAttempts } from "@/lib/loginRateLimit";

const CODE_LIFETIME_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 60;

type PendingRow = RowDataPacket & {
  retryAfterSeconds: number | string;
};

type SignupDetails = {
  email: string;
  fullName: string;
  role: "job_seeker" | "recruiter";
  university: string | null;
  password: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSmtpConfigurationError(error: unknown): boolean {
  return error instanceof Error &&
    (error.message.startsWith("Missing required environment variable: SMTP_") ||
      error.message.startsWith("SMTP_"));
}

function smtpConfigurationMessage(error: unknown): string {
  if (error instanceof Error) {
    const missingVariable = error.message.match(
      /^Missing required environment variable: (SMTP_[A-Z_]+)$/,
    )?.[1];
    if (missingVariable) {
      return `Email verification is missing ${missingVariable}. Add the Brevo SMTP login, SMTP key, and verified sender settings to .env.local, then restart CareerVerse.`;
    }
  }
  return "Email verification has invalid SMTP settings. Check .env.local and restart CareerVerse.";
}

function forwardedAddress(request: Request): string {
  return (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown").slice(0, 100);
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}

function parseSignup(body: unknown): SignupDetails | string {
  if (!isRecord(body)) return "Account details are required.";
  if (body.university !== undefined && typeof body.university !== "string") {
    return "Enter a valid university name.";
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const university = typeof body.university === "string"
    ? body.university.trim().replace(/\s+/g, " ")
    : "";
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  if (body.role !== "recruiter" && body.role !== "job_seeker") return "Choose a valid account type.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return "Enter a valid email address.";
  }
  if (fullName.length < 2 || fullName.length > 100) {
    return "Your name must be between 2 and 100 characters.";
  }
  if (university.length > 160 || (university.length > 0 && university.length < 2)) {
    return "University names must be between 2 and 160 characters.";
  }
  if (password.length < 12 || password.length > 128) {
    return "Use a password between 12 and 128 characters.";
  }
  if (confirmPassword !== password) return "Passwords do not match.";
  return {
    email,
    fullName,
    role: body.role,
    university: university || null,
    password,
  };
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send account details as JSON.", 415);
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
    body = JSON.parse(text) as unknown;
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }

  const details = parseSignup(body);
  if (typeof details === "string") return jsonError(details, 400);

  const forwardedFor = forwardedAddress(request);
  try {
    const [emailLimit, networkLimit] = await consumeLoginAttempts([
      `register-email:${details.email}`,
      ...(forwardedFor === "unknown" ? [] : [`register-network:${forwardedFor}`]),
    ]);
    if (!emailLimit.allowed || (networkLimit && !networkLimit.allowed)) {
      const retryAfter = Math.max(emailLimit.retryAfterSeconds, networkLimit?.retryAfterSeconds ?? 0);
      return NextResponse.json(
        { error: "Too many account creation attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
      );
    }

    const smtp = getSmtpConfiguration();
    await cleanupExpiredEmailRegistrations();
    const password = await hashPassword(details.password);
    const challenge = createEmailVerificationCode(details.email);
    const connection = await getDatabase().getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE",
        [details.email],
      );
      if (users[0]) {
        await connection.rollback();
        return jsonError("An account already exists for that email address.", 409);
      }

      const [pendingRows] = await connection.execute<PendingRow[]>(
        `SELECT GREATEST(
                  0,
                  CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), resend_after) / 1000000)
                ) AS retryAfterSeconds
         FROM pending_email_registrations WHERE email = ? LIMIT 1 FOR UPDATE`,
        [details.email],
      );
      if (pendingRows[0]) {
        const retryAfter = Number(pendingRows[0].retryAfterSeconds);
        if (retryAfter > 0) {
          await connection.rollback();
          return NextResponse.json(
            { error: "Please wait before requesting another verification code.", retryAfterSeconds: retryAfter },
            { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
          );
        }
        await connection.execute(
          `UPDATE pending_email_registrations
           SET full_name = ?, role = ?, university_name = ?, password_salt = ?, password_hash = ?,
               challenge_id = ?, code_digest = ?, attempt_count = 0,
               expires_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
               resend_after = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
           WHERE email = ?`,
          [
            details.fullName, details.role, details.university, password.salt, password.hash,
            challenge.challengeId, challenge.digest, CODE_LIFETIME_SECONDS, RESEND_COOLDOWN_SECONDS,
            details.email,
          ],
        );
      } else {
        await connection.execute(
          `INSERT INTO pending_email_registrations
             (email, full_name, role, university_name, password_salt, password_hash,
              challenge_id, code_digest, attempt_count, expires_at, resend_after)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0,
                   TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
                   TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)))`,
          [
            details.email, details.fullName, details.role, details.university, password.salt,
            password.hash, challenge.challengeId, challenge.digest,
            CODE_LIFETIME_SECONDS, RESEND_COOLDOWN_SECONDS,
          ],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    try {
      await sendEmailVerificationCode(smtp, details.email, challenge.code);
    } catch (error) {
      try {
        await getDatabase().execute(
          "DELETE FROM pending_email_registrations WHERE email = ? AND challenge_id = ?",
          [details.email, challenge.challengeId],
        );
      } catch (cleanupError) {
        console.error("Could not clear a pending registration after email delivery failed.", cleanupError);
      }
      throw error;
    }

    return NextResponse.json(
      { verificationRequired: true, email: details.email, resendAfterSeconds: RESEND_COOLDOWN_SECONDS },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isDuplicateEntry(error)) {
      return jsonError("An account already exists or a signup is already in progress for that email.", 409);
    }
    if (error instanceof EmailDeliveryError) {
      console.error("Verification email delivery failed.", { code: error.code });
      return jsonError("The verification email could not be sent. Check the email settings and try again.", 503);
    }
    if (isSmtpConfigurationError(error)) {
      console.error("Email verification SMTP settings are incomplete.", error);
      return jsonError(smtpConfigurationMessage(error), 503);
    }
    if (isDatabaseUnavailable(error)) {
      console.error("Email registration database setup is incomplete.", error);
      return jsonError("Account services are unavailable. Check the database setup and schema.", 503);
    }
    console.error("Account registration failed.", error);
    return jsonError("We couldn't start email verification. Please try again.", 500);
  }
}
