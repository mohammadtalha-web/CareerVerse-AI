import { NextResponse } from "next/server";
import {
  createGoogleAuthorizationUrl,
  createOAuthSecret,
  getGoogleConfiguration,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_OAUTH_COOKIE_MAX_AGE,
  GOOGLE_OAUTH_COOKIE_PATH,
  GOOGLE_STATE_COOKIE,
  GOOGLE_VERIFIER_COOKIE,
} from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let configuration;
  try {
    configuration = getGoogleConfiguration();
  } catch (error) {
    console.error("Google sign-in configuration is incomplete.", error);
    return NextResponse.redirect(new URL("/login?error=google_not_configured", request.url));
  }

  const state = createOAuthSecret();
  const nonce = createOAuthSecret();
  const verifier = createOAuthSecret();
  const response = NextResponse.redirect(
    createGoogleAuthorizationUrl(configuration, state, nonce, verifier),
  );
  const secure = process.env.NODE_ENV === "production";
  const options = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: GOOGLE_OAUTH_COOKIE_PATH,
    maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE,
  };
  response.cookies.set(GOOGLE_STATE_COOKIE, state, options);
  response.cookies.set(GOOGLE_NONCE_COOKIE, nonce, options);
  response.cookies.set(GOOGLE_VERIFIER_COOKIE, verifier, options);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
