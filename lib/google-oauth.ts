import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from "node:crypto";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTIFICATES_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_SCOPES = "openid email profile";

export const GOOGLE_OAUTH_COOKIE_PATH = "/api/auth/google";
export const GOOGLE_OAUTH_COOKIE_MAX_AGE = 600;
export const GOOGLE_STATE_COOKIE = "careerverse_google_state";
export const GOOGLE_NONCE_COOKIE = "careerverse_google_nonce";
export const GOOGLE_VERIFIER_COOKIE = "careerverse_google_verifier";

type GoogleConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type GoogleTokenResponse = {
  id_token: string;
};

type GoogleJwk = JsonWebKey & {
  kid?: string;
  use?: string;
  alg?: string;
};

type GoogleIdentity = {
  sub: string;
  email: string;
  name: string;
};

type GoogleIdentityClaims = {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  nonce?: unknown;
  exp?: unknown;
  iat?: unknown;
};

type GoogleCertificateSet = {
  keys: GoogleJwk[];
  expiresAt: number;
};

let certificateCache: GoogleCertificateSet | null = null;

function requiredConfiguration(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required environment variable: ${name}`);
  return normalized;
}

export function getGoogleConfiguration(): GoogleConfiguration {
  const clientId = requiredConfiguration(process.env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
  const clientSecret = requiredConfiguration(process.env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET");
  const redirectUri = requiredConfiguration(process.env.GOOGLE_REDIRECT_URI, "GOOGLE_REDIRECT_URI");
  let parsedRedirect: URL;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new Error("GOOGLE_REDIRECT_URI must be an absolute URL.");
  }
  if (
    parsedRedirect.pathname !== "/api/auth/google/callback" ||
    parsedRedirect.search ||
    parsedRedirect.hash ||
    parsedRedirect.username ||
    parsedRedirect.password ||
    (parsedRedirect.protocol !== "https:" &&
      !(parsedRedirect.protocol === "http:" && parsedRedirect.hostname === "localhost"))
  ) {
    throw new Error("GOOGLE_REDIRECT_URI must use the Google callback path and HTTPS outside localhost.");
  }
  return { clientId, clientSecret, redirectUri: parsedRedirect.toString() };
}

export function createGoogleAuthorizationUrl(
  configuration: GoogleConfiguration,
  state: string,
  nonce: string,
  verifier: string,
): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", configuration.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function createOAuthSecret(): string {
  return randomBytes(32).toString("base64url");
}

function constantTimeMatches(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readGoogleCertificates(): Promise<GoogleJwk[]> {
  if (certificateCache && certificateCache.expiresAt > Date.now()) return certificateCache.keys;

  const response = await fetch(GOOGLE_CERTIFICATES_ENDPOINT, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Google signing certificates could not be loaded.");
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.keys)) {
    throw new Error("Google signing certificates returned an invalid response.");
  }
  const keys = payload.keys.filter(
    (key): key is GoogleJwk =>
      isRecord(key) && typeof key.kid === "string" && key.kty === "RSA" && key.use === "sig",
  );
  if (!keys.length) throw new Error("Google signing certificates did not contain signing keys.");

  const maxAge = response.headers.get("cache-control")?.match(/max-age=(\d+)/i)?.[1];
  const cacheSeconds = Math.min(Math.max(Number(maxAge) || 300, 60), 3_600);
  certificateCache = { keys, expiresAt: Date.now() + cacheSeconds * 1000 };
  return keys;
}

function decodeBase64UrlJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new Error("Google returned an invalid identity token.");
  }
}

function claimMatchesAudience(audience: unknown, clientId: string): boolean {
  return audience === clientId || Array.isArray(audience) && audience.includes(clientId);
}

async function verifyGoogleIdentityToken(
  token: string,
  configuration: GoogleConfiguration,
  expectedNonce: string,
): Promise<GoogleIdentity> {
  if (token.length > 16_384) throw new Error("Google returned an invalid identity token.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Google returned an invalid identity token.");

  const header = decodeBase64UrlJson(parts[0]);
  const payloadValue = decodeBase64UrlJson(parts[1]);
  if (
    !isRecord(header) ||
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !isRecord(payloadValue)
  ) {
    throw new Error("Google returned an unsupported identity token.");
  }
  const payload = payloadValue as GoogleIdentityClaims;

  const keys = await readGoogleCertificates();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Google identity token signing key was not recognized.");
  let signature: Buffer;
  try {
    signature = Buffer.from(parts[2], "base64url");
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    const validSignature = verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      signature,
    );
    if (!validSignature) throw new Error("Google identity token signature is invalid.");
  } catch (error) {
    if (error instanceof Error && error.message === "Google identity token signature is invalid.") {
      throw error;
    }
    throw new Error("Google identity token signature could not be verified.");
  }

  const now = Math.floor(Date.now() / 1_000);
  const validIssuer = payload.iss === "https://accounts.google.com" || payload.iss === "accounts.google.com";
  const multipleAudiences = Array.isArray(payload.aud) && payload.aud.length > 1;
  if (
    !validIssuer ||
    !claimMatchesAudience(payload.aud, configuration.clientId) ||
    (multipleAudiences || payload.azp !== undefined) && payload.azp !== configuration.clientId ||
    typeof payload.exp !== "number" ||
    payload.exp <= now ||
    typeof payload.iat !== "number" ||
    payload.iat > now + 60 ||
    payload.iat < now - 3_600 ||
    payload.exp - payload.iat > 3_600 ||
    !constantTimeMatches(typeof payload.nonce === "string" ? payload.nonce : undefined, expectedNonce) ||
    typeof payload.sub !== "string" ||
    !/^[a-zA-Z0-9_-]{1,255}$/.test(payload.sub) ||
    typeof payload.email !== "string" ||
    payload.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
    payload.email_verified !== true
  ) {
    throw new Error("Google identity details could not be verified.");
  }

  const email = payload.email.trim().toLowerCase();
  const fallbackName = email.split("@")[0];
  const name = typeof payload.name === "string" && payload.name.trim()
    ? payload.name.trim().slice(0, 100)
    : fallbackName.slice(0, 100);
  return { sub: payload.sub, email, name };
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  verifier: string,
  configuration: GoogleConfiguration,
  nonce: string,
): Promise<GoogleIdentity> {
  const body = new URLSearchParams({
    code,
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    redirect_uri: configuration.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !isRecord(payload) ||
    typeof payload.id_token !== "string"
  ) {
    throw new Error("Google could not complete sign-in.");
  }
  const tokenResponse = payload as GoogleTokenResponse;
  return verifyGoogleIdentityToken(tokenResponse.id_token, configuration, nonce);
}

export function matchesGoogleOAuthState(actual: string | undefined, expected: string | undefined): boolean {
  return constantTimeMatches(actual, expected);
}
