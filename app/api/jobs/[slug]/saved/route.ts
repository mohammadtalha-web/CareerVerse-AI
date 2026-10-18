import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";

type RouteContext = { params: Promise<{ slug: string }> };
type JobIdRow = RowDataPacket & { id: number; isSample: number; status: string };

async function accountOrResponse() {
  try {
    const account = await getCurrentAccount();
    return account ?? jsonError("Sign in to save opportunities.", 401);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Saved jobs are unavailable. Check the database setup.", 503);
    }
    throw error;
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  const account = await accountOrResponse();
  if (account instanceof Response) return account;
  if (account.role !== "job_seeker") return jsonError("Only job seeker accounts can save jobs.", 403);

  try {
    const { slug } = await params;
    const [rows] = await getDatabase().execute<JobIdRow[]>(
      `SELECT id, is_sample AS isSample, status FROM jobs
       WHERE slug = ? AND status = 'published' AND moderation_hidden = FALSE
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         AND (source_id IS NULL OR EXISTS (
           SELECT 1 FROM job_sources s
           WHERE s.id = jobs.source_id AND s.verified = TRUE AND s.enabled = TRUE
         ))
         AND (employer_id IS NULL OR EXISTS (
           SELECT 1 FROM users u
           WHERE u.id = jobs.employer_id AND u.role = 'recruiter' AND u.recruiter_verified = TRUE
         ))
       LIMIT 1`,
      [slug],
    );
    const job = rows[0];
    if (!job || Boolean(job.isSample)) return jsonError("This sample listing cannot be saved to an account.", 404);
    await getDatabase().execute(
      "INSERT INTO saved_jobs (user_id, job_id) VALUES (?, ?)",
      [account.id, job.id],
    );
    return NextResponse.json({ saved: true }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ saved: true });
    }
    if (isDatabaseUnavailable(error)) return jsonError("Saved jobs are unavailable. Check the database setup.", 503);
    console.error("Saving a job failed.", error);
    return jsonError("We couldn't save this opportunity.", 500);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  const account = await accountOrResponse();
  if (account instanceof Response) return account;
  if (account.role !== "job_seeker") return jsonError("Only job seeker accounts can remove saved jobs.", 403);

  try {
    const { slug } = await params;
    await getDatabase().execute(
      `DELETE saved_jobs FROM saved_jobs
       INNER JOIN jobs ON jobs.id = saved_jobs.job_id
       WHERE saved_jobs.user_id = ? AND jobs.slug = ?`,
      [account.id, slug],
    );
    return NextResponse.json({ saved: false });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Saved jobs are unavailable. Check the database setup.", 503);
    console.error("Removing a saved job failed.", error);
    return jsonError("We couldn't remove this saved opportunity.", 500);
  }
}