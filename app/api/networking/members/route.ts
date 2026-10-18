import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";
import { booleanPrefixSearch } from "@/lib/search";

type MemberRow = RowDataPacket & {
  userId: number;
  fullName: string;
  profileSlug: string;
  headline: string;
  location: string;
  visibility: string;
  photoUrl: string | null;
};

export async function GET(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to discover CareerVerse members.", 401);
    const query = new URL(request.url).searchParams.get("query")?.trim().slice(0, 100) ?? "";
    const booleanQuery = booleanPrefixSearch(query);
    const search = `${query.replace(/[\\%_]/g, "\\$&")}%`;
    const searchJoin = !query
      ? ""
      : booleanQuery
        ? `JOIN (
             SELECT id AS user_id FROM users
             WHERE MATCH(full_name) AGAINST (? IN BOOLEAN MODE)
             UNION
             SELECT user_id FROM networking_profiles
             WHERE MATCH(headline, location, bio) AGAINST (? IN BOOLEAN MODE)
           ) matched_member ON matched_member.user_id = profile.user_id`
        : `JOIN (
             SELECT id AS user_id FROM users WHERE full_name LIKE ?
             UNION
             SELECT user_id FROM networking_profiles WHERE headline LIKE ? OR location LIKE ?
           ) matched_member ON matched_member.user_id = profile.user_id`;
    const [members] = await getDatabase().execute<MemberRow[]>(
      `SELECT profile.user_id AS userId, user.full_name AS fullName, profile.profile_slug AS profileSlug,
              profile.headline, profile.location, profile.visibility,
              CASE WHEN photo.user_id IS NULL THEN NULL
                   ELSE CONCAT('/api/networking/photos/', profile.user_id) END AS photoUrl
       FROM networking_profiles profile JOIN users user ON user.id = profile.user_id
       LEFT JOIN networking_profile_photos photo ON photo.user_id = profile.user_id
       ${searchJoin}
       WHERE profile.visibility = 'public' AND profile.moderation_hidden = FALSE AND profile.user_id <> ?
         AND NOT EXISTS (
           SELECT 1 FROM networking_blocks block
           WHERE (block.blocker_id = ? AND block.blocked_id = profile.user_id)
              OR (block.blocker_id = profile.user_id AND block.blocked_id = ?)
         )
       ORDER BY profile.updated_at DESC LIMIT 30`,
      [
        ...(query ? (booleanQuery ? [booleanQuery, booleanQuery] : [search, search, search]) : []),
        account.id,
        account.id,
        account.id,
      ],
    );
    return NextResponse.json({ members });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Member discovery is unavailable. Check the database setup.", 503);
    console.error("Discovering members failed.", error);
    return jsonError("We couldn't search members.", 500);
  }
}
