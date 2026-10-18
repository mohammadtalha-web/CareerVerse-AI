import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";

type ReportRow = RowDataPacket & {
  id: number;
  targetType: "post" | "profile" | "job";
  targetId: number;
  status: "pending" | "actioned" | "dismissed";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send the moderation decision as JSON.", 415);
  }
  if (Number(request.headers.get("content-length") ?? "0") > 2_048) return jsonError("The request is too large.", 413);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to access administration.", 401);
    if (account.role !== "admin") return jsonError("Administrator access is required.", 403);
    const { id } = await params;
    if (!/^[1-9]\d{0,19}$/.test(id)) return jsonError("That report is not valid.", 400);
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 2_048) return jsonError("The request is too large.", 413);
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { body = null; }
    if (!isRecord(body) || !["hide", "restore", "dismiss"].includes(String(body.decision))) {
      return jsonError("Choose hide, restore, or dismiss.", 400);
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 1000) {
      return jsonError("Provide a moderation reason between 3 and 1,000 characters.", 400);
    }
    const decision = body.decision as "hide" | "restore" | "dismiss";

    const connection = await getDatabase().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<ReportRow[]>(
        `SELECT id, target_type AS targetType, target_id AS targetId, status
         FROM content_reports WHERE id = ? FOR UPDATE`,
        [id],
      );
      const report = rows[0];
      if (!report) {
        await connection.rollback();
        return jsonError("Report not found.", 404);
      }
      if (report.status !== "pending") {
        await connection.rollback();
        return jsonError("This report has already been reviewed.", 409);
      }

      let ownerId: number | null = null;
      let exists = false;
      let alreadyHidden = false;
      if (report.targetType === "post") {
        const [targets] = await connection.execute<RowDataPacket[]>(
          "SELECT user_id AS ownerId, moderation_hidden AS hidden FROM networking_posts WHERE id = ? FOR UPDATE",
          [report.targetId],
        );
        exists = targets.length > 0;
        ownerId = targets[0] ? Number(targets[0].ownerId) : null;
        alreadyHidden = Boolean(targets[0]?.hidden);
      } else if (report.targetType === "profile") {
        const [targets] = await connection.execute<RowDataPacket[]>(
          "SELECT user_id AS ownerId, moderation_hidden AS hidden FROM networking_profiles WHERE user_id = ? FOR UPDATE",
          [report.targetId],
        );
        exists = targets.length > 0;
        ownerId = targets[0] ? Number(targets[0].ownerId) : null;
        alreadyHidden = Boolean(targets[0]?.hidden);
      } else {
        const [targets] = await connection.execute<RowDataPacket[]>(
          "SELECT employer_id AS ownerId, moderation_hidden AS hidden FROM jobs WHERE id = ? AND source_id IS NULL AND is_sample = FALSE FOR UPDATE",
          [report.targetId],
        );
        exists = targets.length > 0;
        ownerId = targets[0]?.ownerId == null ? null : Number(targets[0].ownerId);
        alreadyHidden = Boolean(targets[0]?.hidden);
      }

      if (decision !== "dismiss" && !exists) {
        await connection.rollback();
        return jsonError("Reported content no longer exists. Dismiss the report with a reason.", 409);
      }
      if (decision === "hide" && alreadyHidden) {
        await connection.rollback();
        return jsonError("This content is already hidden. Dismiss the report with a reason.", 409);
      }
      if (decision === "restore" && !alreadyHidden) {
        await connection.rollback();
        return jsonError("This content is already visible.", 409);
      }
      if (decision !== "dismiss") {
        const table = report.targetType === "post" ? "networking_posts" : report.targetType === "profile" ? "networking_profiles" : "jobs";
        const targetKey = report.targetType === "profile" ? "user_id" : "id";
        await connection.execute(`UPDATE ${table} SET moderation_hidden = ? WHERE ${targetKey} = ?`, [decision === "hide", report.targetId]);
      }
      const action = decision === "dismiss" ? "report_dismissed" : `${report.targetType}_${decision === "hide" ? "hidden" : "restored"}`;
      await connection.execute(
        `INSERT INTO admin_audit_log
           (actor_user_id, target_user_id, target_job_id, target_post_id, target_profile_user_id, action, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          account.id,
          report.targetType === "profile" ? report.targetId : ownerId,
          report.targetType === "job" ? report.targetId : null,
          report.targetType === "post" ? report.targetId : null,
          report.targetType === "profile" ? report.targetId : null,
          action,
          reason,
        ],
      );
      await connection.execute(
        "UPDATE content_reports SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [decision === "dismiss" ? "dismissed" : "actioned", account.id, id],
      );
      await connection.commit();
      return NextResponse.json({ status: decision === "dismiss" ? "dismissed" : "actioned" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Admin moderation is unavailable. Apply migration 009.", 503);
    console.error("Reviewing a content report failed.", error);
    return jsonError("We couldn't save this moderation decision.", 500);
  }
}
