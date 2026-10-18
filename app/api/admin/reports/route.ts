import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";

const PAGE_SIZE = 30;
const statuses = ["pending", "actioned", "dismissed", "all"] as const;

export async function GET(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to access administration.", 401);
    if (account.role !== "admin") return jsonError("Administrator access is required.", 403);
    const params = new URL(request.url).searchParams;
    const status = params.get("status") ?? "pending";
    const requestedPage = Number(params.get("page") ?? "1");
    if (!statuses.includes(status as (typeof statuses)[number]) ||
        !Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 10_000) {
      return jsonError("The report filter or page is invalid.", 400);
    }
    const where = status === "all" ? "" : "WHERE report.status = ?";
    const values = status === "all" ? [] : [status];
    const [countRows] = await getDatabase().execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM content_reports report ${where}`,
      values,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)));
    const [rows] = await getDatabase().execute<RowDataPacket[]>(
      `SELECT CAST(report.id AS CHAR) AS id, CAST(report.target_id AS CHAR) AS targetId,
              report.target_type AS targetType, report.reason_category AS category,
              report.details, report.status,
              DATE_FORMAT(report.created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt,
              reporter.full_name AS reporterName,
              COALESCE(post.body, profile_user.full_name, job.title, 'Content no longer available') AS targetLabel,
              COALESCE(post_owner.full_name, profile_user.full_name, employer.full_name) AS targetOwner,
              CASE report.target_type
                WHEN 'post' THEN post.moderation_hidden
                WHEN 'profile' THEN profile.moderation_hidden
                WHEN 'job' THEN job.moderation_hidden
                ELSE NULL
              END AS targetHidden,
              COALESCE(profile.profile_slug, job.slug) AS targetSlug
       FROM content_reports report
       JOIN users reporter ON reporter.id = report.reporter_user_id
       LEFT JOIN networking_posts post ON report.target_type = 'post' AND post.id = report.target_id
       LEFT JOIN users post_owner ON post_owner.id = post.user_id
       LEFT JOIN networking_profiles profile ON report.target_type = 'profile' AND profile.user_id = report.target_id
       LEFT JOIN users profile_user ON profile_user.id = profile.user_id
       LEFT JOIN jobs job ON report.target_type = 'job' AND job.id = report.target_id
       LEFT JOIN users employer ON employer.id = job.employer_id
       ${where}
       ORDER BY (report.status = 'pending') DESC, report.created_at DESC, report.id DESC
       LIMIT ? OFFSET ?`,
      [...values, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );
    return NextResponse.json({ reports: rows, page, pageSize: PAGE_SIZE, total });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Admin reports are unavailable. Apply migration 009.", 503);
    console.error("Loading the admin report queue failed.", error);
    return jsonError("We couldn't load reports.", 500);
  }
}
