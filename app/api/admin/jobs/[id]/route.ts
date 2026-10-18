import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { notifyMembersAboutJob } from "@/lib/notifications";

type JobRow = RowDataPacket & {
  id: string;
  employerId: string | null;
  employerRole: string | null;
  employerVerified: number | null;
  status: "draft" | "published" | "closed";
  expired: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send the moderation decision as JSON.", 415);
  }
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > 2_048) return jsonError("The request is too large.", 413);

  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to access administration.", 401);
    if (account.role !== "admin") return jsonError("Administrator access is required.", 403);

    const { id } = await context.params;
    if (!/^[1-9]\d{0,19}$/.test(id)) return jsonError("That job is not valid.", 400);
    const bodyText = await request.text();
    if (Buffer.byteLength(bodyText, "utf8") > 2_048) return jsonError("The request is too large.", 413);

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return jsonError("The request body must be valid JSON.", 400);
    }
    const reason = isRecord(body) && typeof body.reason === "string" ? body.reason.trim() : "";
    if (!isRecord(body) || !["draft", "published", "closed"].includes(String(body.status))) {
      return jsonError("Choose a valid job status.", 400);
    }
    if (reason.length < 3 || reason.length > 1000) return jsonError("Provide a reason between 3 and 1,000 characters.", 400);
    const nextStatus = body.status as JobRow["status"];

    const connection = await getDatabase().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<JobRow[]>(
        `SELECT CAST(j.id AS CHAR) AS id, CAST(j.employer_id AS CHAR) AS employerId,
                u.role AS employerRole, u.recruiter_verified AS employerVerified,
                j.status, (j.expires_at IS NOT NULL AND j.expires_at <= UTC_TIMESTAMP(3)) AS expired
         FROM jobs j
         LEFT JOIN users u ON u.id = j.employer_id
         WHERE j.id = ? AND j.source_id IS NULL AND j.is_sample = FALSE
         FOR UPDATE`,
        [id],
      );
      const job = rows[0];
      if (!job) {
        await connection.rollback();
        return jsonError("Employer job not found.", 404);
      }
      if (job.status === nextStatus) {
        await connection.commit();
        return NextResponse.json({ status: job.status });
      }
      if (nextStatus === "published" && (job.employerRole !== "recruiter" || !job.employerVerified)) {
        await connection.rollback();
        return jsonError("Only jobs owned by verified recruiters can be published.", 409);
      }
      if (nextStatus === "published" && job.expired) {
        await connection.rollback();
        return jsonError("This job has expired and cannot be republished.", 409);
      }

      await connection.execute(
        `UPDATE jobs SET status = ?,
           published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, UTC_TIMESTAMP(3)) ELSE published_at END
         WHERE id = ?`,
        [nextStatus, nextStatus, id],
      );
      const action = nextStatus === "published"
        ? "job_published"
        : nextStatus === "closed"
          ? "job_closed"
          : "job_unpublished";
      await connection.execute(
        "INSERT INTO admin_audit_log (actor_user_id, target_job_id, action, reason) VALUES (?, ?, ?, ?)",
        [account.id, id, action, reason],
      );
      await connection.commit();
      if (nextStatus === "published") await notifyMembersAboutJob(Number(id));
      return NextResponse.json({ status: nextStatus });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Admin services are unavailable. Check the database setup and migration 009.", 503);
    }
    console.error("Unable to moderate the employer job.", error);
    return jsonError("We couldn't save this job moderation decision.", 500);
  }
}
