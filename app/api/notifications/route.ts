import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { getPushConfiguration } from "@/lib/notifications";
import { parsePositiveId, isRecord } from "@/lib/networking";

type NotificationRow = RowDataPacket & {
  id: number;
  type: string;
  title: string;
  body: string;
  href: string;
  createdAt: Date;
  readAt: Date | null;
};

export async function GET() {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to view notifications.", 401);
    const database = getDatabase();
    const [notifications] = await database.execute<NotificationRow[]>(
      `SELECT id, notification_type AS type, title, body, href,
              created_at AS createdAt, read_at AS readAt
       FROM notifications WHERE user_id = ?
       ORDER BY (read_at IS NULL) DESC, created_at DESC, id DESC LIMIT 30`,
      [account.id],
    );
    const [countRows] = await database.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id = ? AND read_at IS NULL",
      [account.id],
    );
    let pushPublicKey: string | null = null;
    let pushSetupError: string | null = null;
    try {
      pushPublicKey = getPushConfiguration()?.publicKey ?? null;
    } catch (error) {
      pushSetupError = "Browser notifications are not configured on this server.";
      console.error("Browser push configuration is invalid.", error);
    }
    return NextResponse.json({
      notifications,
      unreadCount: Number(countRows[0]?.unreadCount ?? 0),
      pushPublicKey,
      pushSetupError,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Notifications are unavailable. Check the database setup.", 503);
    console.error("Loading notifications failed.", error);
    return jsonError("We couldn't load your notifications.", 500);
  }
}

export async function PATCH(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to update notifications.", 401);
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return jsonError("Send notification changes as JSON.", 415);
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > 2_048) return jsonError("The request is too large.", 413);
    let body: unknown;
    try { body = await request.json(); } catch { return jsonError("Notification details are required.", 400); }
    if (!isRecord(body)) return jsonError("Notification details are required.", 400);
    const database = getDatabase();
    if (body.all === true) {
      await database.execute(
        "UPDATE notifications SET read_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND read_at IS NULL",
        [account.id],
      );
      return NextResponse.json({ updated: true });
    }
    const id = parsePositiveId(body.id);
    if (!id) return jsonError("Choose a valid notification.", 400);
    await database.execute(
      "UPDATE notifications SET read_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ? AND read_at IS NULL",
      [id, account.id],
    );
    return NextResponse.json({ updated: true });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Notifications are unavailable. Check the database setup.", 503);
    console.error("Updating notification read state failed.", error);
    return jsonError("We couldn't update this notification.", 500);
  }
}
