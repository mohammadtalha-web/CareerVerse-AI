import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";

const targets = ["post", "profile", "job"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function PATCH(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send the moderation decision as JSON.", 415);
  }
  if (Number(request.headers.get("content-length") ?? "0") > 2_048) return jsonError("The request is too large.", 413);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to access administration.", 401);
    if (account.role !== "admin") return jsonError("Administrator access is required.", 403);
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 2_048) return jsonError("The request is too large.", 413);
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { body = null; }
    if (!isRecord(body) || !targets.includes(body.targetType as (typeof targets)[number]) ||
        !["hide", "restore"].includes(String(body.decision))) {
      return jsonError("Choose a valid content type and moderation action.", 400);
    }
    const targetId = Number(body.targetId);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!Number.isSafeInteger(targetId) || targetId < 1) return jsonError("The content identifier is invalid.", 400);
    if (reason.length < 3 || reason.length > 1000) return jsonError("Provide a reason between 3 and 1,000 characters.", 400);
    const targetType = body.targetType as (typeof targets)[number];
    const decision = body.decision as "hide" | "restore";
    const table = targetType === "post" ? "networking_posts" : targetType === "profile" ? "networking_profiles" : "jobs";
    const key = targetType === "profile" ? "user_id" : "id";
    const ownerKey = targetType === "job" ? "employer_id" : "user_id";
    const predicate = targetType === "job" ? "AND source_id IS NULL AND is_sample = FALSE" : "";

    const connection = await getDatabase().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT ${key} AS targetId, ${ownerKey} AS ownerId, moderation_hidden AS hidden
         FROM ${table} WHERE ${key} = ? ${predicate} FOR UPDATE`,
        [targetId],
      );
      const target = rows[0];
      if (!target) {
        await connection.rollback();
        return jsonError("Content not found or not eligible for moderation.", 404);
      }
      if (Boolean(target.hidden) === (decision === "hide")) {
        await connection.rollback();
        return jsonError(decision === "hide" ? "Content is already hidden." : "Content is already visible.", 409);
      }
      await connection.execute(`UPDATE ${table} SET moderation_hidden = ? WHERE ${key} = ?`, [decision === "hide", targetId]);
      const action = `${targetType}_${decision === "hide" ? "hidden" : "restored"}`;
      await connection.execute(
        `INSERT INTO admin_audit_log
           (actor_user_id, target_user_id, target_job_id, target_post_id, target_profile_user_id, action, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          account.id,
          targetType === "profile" ? targetId : (target.ownerId == null ? null : Number(target.ownerId)),
          targetType === "job" ? targetId : null,
          targetType === "post" ? targetId : null,
          targetType === "profile" ? targetId : null,
          action,
          reason,
        ],
      );
      await connection.commit();
      return NextResponse.json({ moderationHidden: decision === "hide" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Admin moderation is unavailable. Apply migration 009.", 503);
    console.error("Changing content visibility failed.", error);
    return jsonError("We couldn't change this content's visibility.", 500);
  }
}
