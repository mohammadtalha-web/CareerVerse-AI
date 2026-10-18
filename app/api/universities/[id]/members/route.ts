import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";

const PAGE_SIZE = 20;
const MAX_PAGE = 100_000;

type UniversityMemberRow = RowDataPacket & {
  userId: number | string;
  fullName: string;
  profileSlug: string;
  headline: string;
  location: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!/^[1-9]\d{0,19}$/.test(id)) return jsonError("Choose a valid university.", 400);

    const url = new URL(request.url);
    const requestedPage = Number(url.searchParams.get("page") ?? "1");
    const page = Number.isInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, MAX_PAGE)
      : 1;
    const account = await getCurrentAccount();
    const database = getDatabase();
    const blockFilter = account
      ? `AND NOT EXISTS (
           SELECT 1 FROM networking_blocks block
           WHERE (block.blocker_id = ? AND block.blocked_id = profile.user_id)
              OR (block.blocker_id = profile.user_id AND block.blocked_id = ?)
         )`
      : "";
    const parameters = account ? [id, account.id, account.id] : [id];
    const [countRows] = await database.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM users
       INNER JOIN networking_profiles profile ON profile.user_id = users.id
       WHERE users.university_id = ? AND users.is_active = TRUE
         AND profile.visibility = 'public' AND profile.moderation_hidden = FALSE
         ${blockFilter}`,
      parameters,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * PAGE_SIZE;
    const [members] = await database.execute<UniversityMemberRow[]>(
      `SELECT users.id AS userId, users.full_name AS fullName,
              profile.profile_slug AS profileSlug, profile.headline, profile.location
       FROM users
       INNER JOIN networking_profiles profile ON profile.user_id = users.id
       WHERE users.university_id = ? AND users.is_active = TRUE
         AND profile.visibility = 'public' AND profile.moderation_hidden = FALSE
         ${blockFilter}
       ORDER BY profile.updated_at DESC, users.id DESC
       LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      parameters,
    );
    return NextResponse.json({
      members: members.map((member) => ({ ...member, userId: String(member.userId) })),
      page: currentPage,
      pageSize: PAGE_SIZE,
      total,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("University members are unavailable. Check the database connection and schema.", 503);
    }
    console.error("Unable to load university members.", error);
    return jsonError("We couldn't load this university's members.", 500);
  }
}
