import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { getDatabase } from "@/lib/db";

const REGISTRATION_CLEANUP_INTERVAL_MS = 60_000;
const REGISTRATION_CLEANUP_BATCH_SIZE = 250;

declare global {
  var careerVerseEmailRegistrationCleanupAt: number | undefined;
}

type SmtpConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export class EmailDeliveryError extends Error {
  constructor(readonly code: string) {
    super("The verification email could not be delivered.");
    this.name = "EmailDeliveryError";
  }
}

function requiredConfiguration(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getSmtpConfiguration(): SmtpConfiguration {
  const host = requiredConfiguration("SMTP_HOST").trim();
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host)) throw new Error("SMTP_HOST is invalid.");

  const portValue = requiredConfiguration("SMTP_PORT").trim();
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }

  const secureValue = requiredConfiguration("SMTP_SECURE").trim().toLowerCase();
  if (secureValue !== "true" && secureValue !== "false") {
    throw new Error("SMTP_SECURE must be true or false.");
  }

  const user = requiredConfiguration("SMTP_USER");
  const password = requiredConfiguration("SMTP_PASSWORD");
  const from = requiredConfiguration("SMTP_FROM").trim();
  if (from.length > 320 || /[\r\n]/.test(from)) throw new Error("SMTP_FROM is invalid.");

  return { host, port, secure: secureValue === "true", user, password, from };
}

function createCodeDigest(email: string, challengeId: string, code: string): Buffer {
  const secret = requiredConfiguration("SMTP_PASSWORD");
  return createHmac("sha256", secret)
    .update(`${email}\n${challengeId}\n${code}`)
    .digest();
}

export function createEmailVerificationCode(email: string): {
  code: string;
  challengeId: string;
  digest: string;
} {
  const challengeId = randomBytes(16).toString("hex");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return {
    code,
    challengeId,
    digest: createCodeDigest(email, challengeId, code).toString("hex"),
  };
}

export function matchesEmailVerificationCode(
  email: string,
  challengeId: string,
  code: string,
  digest: string,
): boolean {
  if (!/^[0-9]{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(digest)) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = createCodeDigest(email, challengeId, code);
  return timingSafeEqual(actual, expected);
}

export async function cleanupExpiredEmailRegistrations(): Promise<void> {
  const now = Date.now();
  const lastCleanup = globalThis.careerVerseEmailRegistrationCleanupAt ?? 0;
  if (now - lastCleanup < REGISTRATION_CLEANUP_INTERVAL_MS) return;

  globalThis.careerVerseEmailRegistrationCleanupAt = now;
  try {
    await getDatabase().execute(
      `DELETE FROM pending_email_registrations
       WHERE expires_at <= UTC_TIMESTAMP(3)
       ORDER BY expires_at
       LIMIT ${REGISTRATION_CLEANUP_BATCH_SIZE}`,
    );
  } catch (error) {
    globalThis.careerVerseEmailRegistrationCleanupAt = 0;
    throw error;
  }
}

export async function sendEmailVerificationCode(
  configuration: SmtpConfiguration,
  email: string,
  code: string,
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    auth: { user: configuration.user, pass: configuration.password },
    requireTLS: process.env.NODE_ENV === "production" && !configuration.secure,
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  try {
    try {
      await transporter.sendMail({
        from: configuration.from,
        to: email,
        subject: "Your CareerVerse verification code",
        text: `Your CareerVerse verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
        html: `<p>Use this code to verify your email address and finish creating your CareerVerse account:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`,
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null &&
        "code" in error && typeof error.code === "string" ? error.code : "unknown";
      throw new EmailDeliveryError(code);
    }
  } finally {
    transporter.close();
  }
}
