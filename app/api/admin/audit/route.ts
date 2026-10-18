import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";

const PAGE_SIZE = 50;
const filters = {
  all: [],
  reports: ["report_dismissed"],
  recruiters: ["recruiter_verified", "recruiter_unverified"],
  jobs: ["job_published", "job_unpublished", "job_closed", "job_hidden", "job_restored"],
  content: ["post_hidden", "post_restored", "profile_hidden", "profile_restored"],
} as const;

export async function GET(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to access administration.", 401);
    if (account.role !== "admin") return jsonError("Administrator access is required.", 403);
    const params = new URL(request.url).searchParams;
    const pageInput = Number(params.get("page") ?? "1");
    const filterInput = params.get("filter") ?? "all";
    if (!Number.isSafeInteger(pageInput) || pageInput < 1 || pageInput > 10_000 ||
        !Object.hasOwn(filters, filterInput)) {
      return jsonError("The audit filter or page is invalid.", 400);
    }
    const selectedFilter = filters[filterInput as keyof typeof filters];
    const where = selectedFilter.length ? `WHERE audit.action IN (${selectedFilter.map(() => "?").join(", ")})` : "";
    const [countRows] = await getDatabase().execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM admin_audit_log audit ${where}`,
      [...selectedFilter],
    );
    const total = Number(countRows[0]?.total ?? 0);
    const page = Math.min(pageInput, Math.max(1, Math.ceil(total / PAGE_SIZE)));
    const [rows] = await getDatabase().execute<RowDataPacket[]>(
      `SELECT CAST(audit.id AS CHAR) AS id, audit.action, audit.reason,
              CAST(audit.target_job_id AS CHAR) AS targetJobId,
              CAST(audit.target_post_id AS CHAR) AS targetPostId,
              CAST(audit.target_profile_user_id AS CHAR) AS targetProfileUserId,
              CASE
                WHEN audit.target_post_id IS NOT NULL THEN post.moderation_hidden
                WHEN audit.target_profile_user_id IS NOT NULL THEN profile.moderation_hidden
                WHEN audit.target_job_id IS NOT NULL THEN job.moderation_hidden
                ELSE NULL
              END AS targetHidden,
              DATE_FORMAT(audit.created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt,
              actor.full_name AS actorName, target_user.full_name AS targetUserName,
              job.title AS targetJobTitle, post.body AS targetPostBody,
              profile_user.full_name AS targetProfileName
       FROM admin_audit_log audit
       JOIN users actor ON actor.id = audit.actor_user_id
       LEFT JOIN users target_user ON target_user.id = audit.target_user_id
       LEFT JOIN jobs job ON job.id = audit.target_job_id
       LEFT JOIN networking_posts post ON post.id = audit.target_post_id
       LEFT JOIN networking_profiles profile ON profile.user_id = audit.target_profile_user_id
       LEFT JOIN users profile_user ON profile_user.id = profile.user_id
       ${where}
       ORDER BY audit.created_at DESC, audit.id DESC LIMIT ? OFFSET ?`,
      [...selectedFilter, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );
    return NextResponse.json({ entries: rows, page, pageSize: PAGE_SIZE, total });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Admin audit history is unavailable. Apply migration 009.", 503);
    console.error("Loading admin audit history failed.", error);
    return jsonError("We couldn't load the audit history.", 500);
  }
}
