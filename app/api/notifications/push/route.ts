import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { endpointHash, getPushConfiguration } from "@/lib/notifications";
import { isRecord } from "@/lib/networking";

type PushKey = { p256dh: string; auth: string };

function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const approvedHost =
      host === "fcm.googleapis.com" ||
      host === "web.push.apple.com" ||
      host === "push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com");
    return url.protocol === "https:" && !url.username && !url.password && approvedHost;
  } catch {
    return false;
  }
}

function isPushKey(value: unknown): value is PushKey {
  return typeof value === "object" && value !== null &&
    "p256dh" in value && typeof value.p256dh === "string" &&
    /^[A-Za-z0-9_-]{80,100}$/.test(value.p256dh) &&
    "auth" in value && typeof value.auth === "string" &&
    /^[A-Za-z0-9_-]{16,32}$/.test(value.auth);
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to enable browser notifications.", 401);
    let configuration: ReturnType<typeof getPushConfiguration>;
    try {
      configuration = getPushConfiguration();
    } catch (error) {
      console.error("Browser push configuration is invalid.", error);
      return jsonError("Browser notifications are not configured on this server.", 503);
    }
    if (!configuration) return jsonError("Browser notifications are not configured on this server.", 503);
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return jsonError("Send the browser subscription as JSON.", 415);
    }
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > 8_192) return jsonError("The browser subscription is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { return jsonError("A browser subscription is required.", 400); }
    if (!isRecord(body) || !validPushEndpoint(body.endpoint) || !isPushKey(body.keys)) {
      return jsonError("The browser subscription is invalid or uses an unsupported push service.", 400);
    }
    const hash = endpointHash(body.endpoint);
    await getDatabase().execute(
      `INSERT INTO push_subscriptions
         (user_id, endpoint_hash, endpoint, p256dh_key, auth_key)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id), endpoint = VALUES(endpoint),
         p256dh_key = VALUES(p256dh_key), auth_key = VALUES(auth_key)`,
      [account.id, hash, body.endpoint, body.keys.p256dh, body.keys.auth],
    );
    return NextResponse.json({ subscribed: true }, { status: 201 });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Browser notifications are unavailable. Check the database setup.", 503);
    console.error("Saving a browser push subscription failed.", error);
    return jsonError("We couldn't enable browser notifications.", 500);
  }
}

export async function DELETE(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to manage browser notifications.", 401);
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return jsonError("Send the browser subscription as JSON.", 415);
    }
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > 4_096) return jsonError("The browser subscription is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { return jsonError("A browser subscription is required.", 400); }
    if (!isRecord(body) || !validPushEndpoint(body.endpoint)) {
      return jsonError("The browser subscription is invalid.", 400);
    }
    await getDatabase().execute(
      "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?",
      [account.id, endpointHash(body.endpoint)],
    );
    return NextResponse.json({ subscribed: false });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Browser notifications are unavailable. Check the database setup.", 503);
    console.error("Removing a browser push subscription failed.", error);
    return jsonError("We couldn't disable browser notifications.", 500);
  }
}
