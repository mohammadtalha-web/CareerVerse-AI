import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function forwardedAddress(request: Request): string {
  return (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown").slice(0, 100);
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

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send the email address as JSON.", 415);
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
  if (!isRecord(body)) return jsonError("An email address is required.", 400);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return jsonError("Enter a valid email address.", 400);
  }

  const forwardedFor = forwardedAddress(request);
  try {
    const [emailLimit, networkLimit] = await consumeLoginAttempts([
      `register-resend-email:${email}`,
      ...(forwardedFor === "unknown" ? [] : [`register-resend-network:${forwardedFor}`]),
    ]);
    if (!emailLimit.allowed || (networkLimit && !networkLimit.allowed)) {
      const retryAfter = Math.max(emailLimit.retryAfterSeconds, networkLimit?.retryAfterSeconds ?? 0);
      return NextResponse.json(
        { error: "Too many code requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
      );
    }

    const smtp = getSmtpConfiguration();
    const challenge = createEmailVerificationCode(email);
    const connection = await getDatabase().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<PendingRow[]>(
        `SELECT GREATEST(
                  0,
                  CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), resend_after) / 1000000)
                ) AS retryAfterSeconds
         FROM pending_email_registrations WHERE email = ? LIMIT 1 FOR UPDATE`,
        [email],
      );
      const pending = rows[0];
      if (!pending) {
        await connection.rollback();
        return jsonError("No signup is waiting for verification. Return to the signup form and try again.", 404);
      }
      const retryAfter = Number(pending.retryAfterSeconds);
      if (retryAfter > 0) {
        await connection.rollback();
        return NextResponse.json(
          { error: "Please wait before requesting another verification code.", retryAfterSeconds: retryAfter },
          { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
        );
      }
      await connection.execute(
        `UPDATE pending_email_registrations
         SET challenge_id = ?, code_digest = ?, attempt_count = 0,
             expires_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
             resend_after = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
         WHERE email = ?`,
        [challenge.challengeId, challenge.digest, CODE_LIFETIME_SECONDS, RESEND_COOLDOWN_SECONDS, email],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    try {
      await sendEmailVerificationCode(smtp, email, challenge.code);
    } catch (error) {
      try {
        await getDatabase().execute(
          "DELETE FROM pending_email_registrations WHERE email = ? AND challenge_id = ?",
          [email, challenge.challengeId],
        );
      } catch (cleanupError) {
        console.error("Could not clear a pending registration after email delivery failed.", cleanupError);
      }
      throw error;
    }

    return NextResponse.json(
      { sent: true, resendAfterSeconds: RESEND_COOLDOWN_SECONDS },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof EmailDeliveryError) {
      console.error("Verification email delivery failed.", { code: error.code });
      return jsonError("The verification email could not be sent. Check the email settings and try again.", 503);
    }
    if (isSmtpConfigurationError(error)) {
      console.error("Email verification SMTP settings are incomplete.", error);
      return jsonError(smtpConfigurationMessage(error), 503);
    }
    if (isDatabaseUnavailable(error)) {
      console.error("Email verification database setup is incomplete.", error);
      return jsonError("Account services are unavailable. Check the database setup and schema.", 503);
    }
    console.error("Email code resend failed.", error);
    return jsonError("We couldn't resend your verification code. Please try again.", 500);
  }
}
