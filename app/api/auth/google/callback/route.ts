import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable } from "@/lib/http";
import {
  exchangeGoogleAuthorizationCode,
  getGoogleConfiguration,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_OAUTH_COOKIE_PATH,
  GOOGLE_STATE_COOKIE,
  GOOGLE_VERIFIER_COOKIE,
  matchesGoogleOAuthState,
} from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

type GoogleAccountRow = RowDataPacket & {
  id: number;
  googleSubject: string | null;
  role: "job_seeker" | "recruiter" | "admin";
  isActive: number | boolean;
};

function redirectToPage(request: Request, path: "/login" | "/account" | "/admin" | "/networking/feed", error?: string) {
  const url = new URL(path, request.url);
  if (error) url.searchParams.set("error", error);
  const response = NextResponse.redirect(url);
  for (const name of [GOOGLE_STATE_COOKIE, GOOGLE_NONCE_COOKIE, GOOGLE_VERIFIER_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: GOOGLE_OAUTH_COOKIE_PATH,
      maxAge: 0,
    });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}

function isGoogleSchemaMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_BAD_FIELD_ERROR";
}

async function findOrCreateGoogleAccount(
  identity: { sub: string; email: string; name: string },
): Promise<{ id: number; role: GoogleAccountRow["role"] }> {
  const connection = await getDatabase().getConnection();
  try {
    await connection.beginTransaction();
    const [subjectRows] = await connection.execute<GoogleAccountRow[]>(
      "SELECT id, google_subject AS googleSubject, role, is_active AS isActive FROM users WHERE google_subject = ? LIMIT 1 FOR UPDATE",
      [identity.sub],
    );
    if (subjectRows[0]) {
      if (!Boolean(subjectRows[0].isActive)) {
        throw new Error("This CareerVerse account is inactive.");
      }
      await connection.execute(
        "UPDATE users SET full_name = ? WHERE id = ?",
        [identity.name, subjectRows[0].id],
      );
      await connection.execute("DELETE FROM pending_email_registrations WHERE email = ?", [identity.email]);
      await connection.commit();
      return { id: Number(subjectRows[0].id), role: subjectRows[0].role };
    }

    const [emailRows] = await connection.execute<GoogleAccountRow[]>(
      "SELECT id, google_subject AS googleSubject, role, is_active AS isActive FROM users WHERE email = ? LIMIT 1 FOR UPDATE",
      [identity.email],
    );
    const emailAccount = emailRows[0];
    if (emailAccount) {
      if (!Boolean(emailAccount.isActive)) {
        throw new Error("This CareerVerse account is inactive.");
      }
      if (emailAccount.googleSubject && emailAccount.googleSubject !== identity.sub) {
        throw new Error("This email is already connected to a different Google account.");
      }
      await connection.execute(
        "UPDATE users SET google_subject = ?, full_name = ? WHERE id = ? AND google_subject IS NULL",
        [identity.sub, identity.name, emailAccount.id],
      );
      await connection.execute("DELETE FROM pending_email_registrations WHERE email = ?", [identity.email]);
      await connection.commit();
      return { id: Number(emailAccount.id), role: emailAccount.role };
    }

    const passwordSalt = randomBytes(16).toString("hex");
    const passwordHash = randomBytes(64).toString("hex");
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO users
         (email, full_name, role, google_subject, password_salt, password_hash)
       VALUES (?, ?, 'job_seeker', ?, ?, ?)`,
      [identity.email, identity.name, identity.sub, passwordSalt, passwordHash],
    );
    const accountId = Number(result.insertId);
    if (!Number.isSafeInteger(accountId) || accountId < 1) {
      throw new Error("Google account creation did not return a valid identifier.");
    }
    await connection.execute("DELETE FROM pending_email_registrations WHERE email = ?", [identity.email]);
    await connection.commit();
    return { id: accountId, role: "job_seeker" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const queryError = url.searchParams.get("error");
  if (queryError) {
    return redirectToPage(request, "/login", queryError === "access_denied" ? "google_cancelled" : "google_failed");
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_STATE_COOKIE)?.value;
  const nonce = cookieStore.get(GOOGLE_NONCE_COOKIE)?.value;
  const verifier = cookieStore.get(GOOGLE_VERIFIER_COOKIE)?.value;
  if (
    !code ||
    code.length > 4_096 ||
    !matchesGoogleOAuthState(returnedState ?? undefined, expectedState) ||
    !nonce ||
    !verifier
  ) {
    return redirectToPage(request, "/login", "google_invalid");
  }

  try {
    const configuration = getGoogleConfiguration();
    const identity = await exchangeGoogleAuthorizationCode(code, verifier, configuration, nonce);
    const account = await findOrCreateGoogleAccount(identity);
    await createSession(account.id);
    return redirectToPage(request, account.role === "admin" ? "/admin" : "/networking/feed");
  } catch (error) {
    if (isDuplicateEntry(error)) {
      return redirectToPage(request, "/login", "google_email_exists");
    }
    if (
      error instanceof Error &&
      (error.message.startsWith("Missing required environment variable:") ||
        error.message.startsWith("GOOGLE_REDIRECT_URI"))
    ) {
      console.error("Google sign-in configuration is incomplete.", error);
      return redirectToPage(request, "/login", "google_not_configured");
    }
    if (isDatabaseUnavailable(error) || isGoogleSchemaMissing(error)) {
      console.error("Google sign-in database setup is incomplete.", error);
      return redirectToPage(request, "/login", "google_setup_required");
    }
    console.error("Google sign-in callback failed.", error);
    return redirectToPage(request, "/login", "google_failed");
  }
}
