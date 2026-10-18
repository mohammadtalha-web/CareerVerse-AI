import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { notifyAfterEvent } from "@/lib/notifications";
import type { RowDataPacket } from "mysql2";

type RouteContext = { params: Promise<{ id: string }> };
type ApplicationRow = RowDataPacket & {
  applicantId: number;
  currentStatus: string;
  jobTitle: string;
};
const allowedStatuses = new Set(["screening", "interview", "offer", "rejected"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);

  let account;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Hiring tools are unavailable. Check the database setup.", 503);
    console.error("Unable to verify the employer account.", error);
    return jsonError("We couldn't verify your account.", 500);
  }
  if (!account) return jsonError("Sign in to manage applications.", 401);
  if (account.role !== "recruiter" || !account.recruiterVerified) {
    return jsonError("A verified recruiter account is required.", 403);
  }

  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > 2_048) return jsonError("The request is too large.", 413);
  let text: string;
  try {
    text = await request.text();
  } catch {
    return jsonError("The request body could not be read.", 400);
  }
  if (Buffer.byteLength(text, "utf8") > 2_048) return jsonError("The request is too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }
  if (!isRecord(body) || typeof body.status !== "string" || !allowedStatuses.has(body.status)) {
    return jsonError("Choose a valid application status.", 400);
  }

  const { id } = await params;
  if (!/^[1-9]\d{0,19}$/.test(id)) return jsonError("Application was not found.", 404);
  try {
    const connection = await getDatabase().getConnection();
    let application: ApplicationRow | undefined;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<ApplicationRow[]>(
        `SELECT a.user_id AS applicantId, a.status AS currentStatus, j.title AS jobTitle
         FROM applications a
         INNER JOIN jobs j ON j.id = a.job_id
         WHERE a.id = ? AND j.employer_id = ? AND j.source_id IS NULL
           AND a.status NOT IN ('withdrawn', 'rejected')
         LIMIT 1 FOR UPDATE`,
        [id, account.id],
      );
      application = rows[0];
      if (!application) {
        await connection.rollback();
        return jsonError("Application was not found or is no longer editable.", 404);
      }
      if (application.currentStatus === body.status) {
        await connection.commit();
        return NextResponse.json({ status: body.status });
      }
      await connection.execute(
        "UPDATE applications SET status = ? WHERE id = ?",
        [body.status, id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await notifyAfterEvent({
      userId: application.applicantId,
      actorUserId: account.id,
      type: "application_update",
      title: "Application status updated",
      body: `Your application for ${application.jobTitle} was moved to ${body.status}.`,
      href: "/account",
      dedupeKey: `application-update:${id}:${Date.now()}`,
    });
    return NextResponse.json({ status: body.status });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Hiring tools are unavailable. Check the database schema.", 503);
    console.error("Employer application update failed.", error);
    return jsonError("We couldn't update the application. Please try again.", 500);
  }
}