import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";

const categories = ["spam_scam", "harassment", "inappropriate", "misleading", "other"] as const;
const targetTypes = ["post", "profile", "job"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send report details as JSON.", 415);
  }
  if (Number(request.headers.get("content-length") ?? "0") > 8_192) return jsonError("The request is too large.", 413);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to report content.", 401);
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 8_192) return jsonError("The request is too large.", 413);
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { body = null; }
    if (!isRecord(body) || !targetTypes.includes(body.targetType as (typeof targetTypes)[number]) ||
        !categories.includes(body.category as (typeof categories)[number])) {
      return jsonError("Choose a valid report category and content type.", 400);
    }
    const targetId = Number(body.targetId);
    if (!Number.isSafeInteger(targetId) || targetId < 1) return jsonError("The reported content is invalid.", 400);
    if (body.details !== undefined && body.details !== null && typeof body.details !== "string") {
      return jsonError("Additional details must be text.", 400);
    }
    const details = typeof body.details === "string" ? body.details.trim() : "";
    if (details.length > 1000) return jsonError("Additional details must be 1,000 characters or fewer.", 400);
    const targetType = body.targetType as (typeof targetTypes)[number];
    const category = body.category as (typeof categories)[number];
    if ((targetType === "post" || targetType === "profile") && targetId === account.id) {
      return jsonError("You cannot report your own content.", 400);
    }

    const database = getDatabase();
    let targetExists = false;
    if (targetType === "post") {
      const [rows] = await database.execute<RowDataPacket[]>(
        "SELECT id FROM networking_posts WHERE id = ? AND moderation_hidden = FALSE",
        [targetId],
      );
      targetExists = rows.length > 0;
    } else if (targetType === "profile") {
      const [rows] = await database.execute<RowDataPacket[]>(
        "SELECT user_id FROM networking_profiles WHERE user_id = ? AND visibility = 'public' AND moderation_hidden = FALSE",
        [targetId],
      );
      targetExists = rows.length > 0;
    } else {
      const [rows] = await database.execute<RowDataPacket[]>(
        `SELECT id FROM jobs
         WHERE id = ? AND source_id IS NULL AND is_sample = FALSE
           AND status = 'published' AND moderation_hidden = FALSE
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
        [targetId],
      );
      targetExists = rows.length > 0;
    }
    if (!targetExists) return jsonError("This content cannot be reported or is no longer available.", 404);

    try {
      const [result] = await database.execute<ResultSetHeader>(
        `INSERT INTO content_reports
           (reporter_user_id, target_type, target_id, reason_category, details)
         VALUES (?, ?, ?, ?, ?)`,
        [account.id, targetType, targetId, category, details || null],
      );
      return NextResponse.json({ id: result.insertId }, { status: 201 });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
        return jsonError("You already have an open report for this content.", 409);
      }
      throw error;
    }
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Reporting is unavailable. Check the database setup and migration 009.", 503);
    console.error("Submitting a content report failed.", error);
    return jsonError("We couldn't submit this report.", 500);
  }
}
