import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { isRecord, parsePositiveId, removeStoredUpload } from "@/lib/networking";

type Context = { params: Promise<{ id: string }> };

async function authorizedPost(postId: number, accountId: number) {
  const [rows] = await getDatabase().execute<RowDataPacket[]>(
    `SELECT post.id, post.user_id AS userId FROM networking_posts post
     WHERE post.id = ? AND (post.moderation_hidden = FALSE OR post.user_id = ?) AND NOT EXISTS (
       SELECT 1 FROM networking_blocks block
       WHERE (block.blocker_id = ? AND block.blocked_id = post.user_id)
          OR (block.blocker_id = post.user_id AND block.blocked_id = ?)
     ) LIMIT 1`,
    [postId, accountId, accountId, accountId],
  );
  return rows[0] as { id: number; userId: number } | undefined;
}

export async function GET(request: Request, { params }: Context) {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to view post activity.", 401);
    const postId = parsePositiveId((await params).id);
    if (!postId) return jsonError("Post not found.", 404);
    const post = await authorizedPost(postId, account.id);
    if (!post) return jsonError("Post not found.", 404);
    if (new URL(request.url).searchParams.get("view") === "reactions") {
      const [reactions] = await getDatabase().execute<RowDataPacket[]>(
        `SELECT member_user.id AS userId, member_user.full_name AS fullName,
                CASE WHEN profile.visibility = 'public' AND profile.moderation_hidden = FALSE
                     THEN profile.profile_slug ELSE NULL END AS slug,
                CASE WHEN profile.visibility = 'public' AND profile.moderation_hidden = FALSE
                           AND profile_photo.user_id IS NOT NULL
                     THEN CONCAT('/api/networking/photos/', member_user.id) ELSE NULL END AS photoUrl,
                reaction.reaction AS reaction
         FROM networking_reactions reaction
         JOIN users member_user ON member_user.id = reaction.user_id AND member_user.is_active = TRUE
         LEFT JOIN networking_profiles profile ON profile.user_id = member_user.id
         LEFT JOIN networking_profile_photos profile_photo ON profile_photo.user_id = member_user.id
         WHERE reaction.post_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM networking_blocks user_block
             WHERE (user_block.blocker_id = ? AND user_block.blocked_id = member_user.id)
                OR (user_block.blocker_id = member_user.id AND user_block.blocked_id = ?)
           )
         ORDER BY reaction.created_at DESC, member_user.id DESC`,
        [postId, account.id, account.id],
      );
      return NextResponse.json({ reactions });
    }
    const [comments] = await getDatabase().execute<RowDataPacket[]>(
      `SELECT feed_comment.id, feed_comment.user_id AS userId, member_user.full_name AS author,
              CASE WHEN profile.visibility = 'public' OR feed_comment.user_id = ? THEN profile.profile_slug ELSE NULL END AS slug,
              feed_comment.body, feed_comment.created_at AS createdAt
       FROM networking_comments feed_comment
       JOIN users member_user ON member_user.id = feed_comment.user_id
       LEFT JOIN networking_profiles profile ON profile.user_id = feed_comment.user_id
       WHERE feed_comment.post_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM networking_blocks user_block
           WHERE (user_block.blocker_id = ? AND user_block.blocked_id = feed_comment.user_id)
              OR (user_block.blocker_id = feed_comment.user_id AND user_block.blocked_id = ?)
         )
       ORDER BY feed_comment.created_at ASC, feed_comment.id ASC LIMIT 100`,
      [account.id, postId, account.id, account.id],
    );
    return NextResponse.json({ comments });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Post comments are unavailable.", 503);
    console.error("Loading post comments failed.", error);
    return jsonError("We couldn't load comments.", 500);
  }
}

export async function POST(request: Request, { params }: Context) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to interact with the career feed.", 401);
    const postId = parsePositiveId((await params).id);
    if (!postId) return jsonError("Post not found.", 404);
    let body: unknown;
    try { body = await request.json(); } catch { return jsonError("An interaction is required.", 400); }
    if (!isRecord(body) || typeof body.action !== "string") return jsonError("Choose a comment or reaction.", 400);
    const post = await authorizedPost(postId, account.id);
    if (!post) return jsonError("Post not found.", 404);
    if (body.action === "comment") {
      const comment = typeof body.body === "string" ? body.body.trim() : "";
      if (!comment || comment.length > 2000) return jsonError("Comments must contain 1–2,000 characters.", 400);
      const [result] = await getDatabase().execute<ResultSetHeader>(
        "INSERT INTO networking_comments (post_id, user_id, body) VALUES (?, ?, ?)",
        [postId, account.id, comment],
      );
      return NextResponse.json({ id: result.insertId }, { status: 201 });
    }
    if (body.action === "react") {
      const reaction = body.reaction;
      if (typeof reaction !== "string" || !["like", "celebrate", "insightful"].includes(reaction)) {
        return jsonError("Choose a supported reaction.", 400);
      }
      const [existing] = await getDatabase().execute<RowDataPacket[]>(
        "SELECT reaction FROM networking_reactions WHERE post_id = ? AND user_id = ? LIMIT 1",
        [postId, account.id],
      );
      if (existing[0]?.reaction === reaction) {
        await getDatabase().execute("DELETE FROM networking_reactions WHERE post_id = ? AND user_id = ?", [postId, account.id]);
        return NextResponse.json({ reaction: null });
      }
      await getDatabase().execute(
        `INSERT INTO networking_reactions (post_id, user_id, reaction) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reaction = VALUES(reaction)`,
        [postId, account.id, reaction],
      );
      return NextResponse.json({ reaction });
    }
    return jsonError("That post action is not supported.", 400);
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("The career feed is unavailable.", 503);
    console.error("Updating a post interaction failed.", error);
    return jsonError("We couldn't update this post.", 500);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to edit your post.", 401);
    const postId = parsePositiveId((await params).id);
    if (!postId) return jsonError("Post not found.", 404);
    let body: unknown;
    try { body = await request.json(); } catch { return jsonError("Post details are required.", 400); }
    if (!isRecord(body) || typeof body.body !== "string") return jsonError("Post text is required.", 400);
    const text = body.body.trim();
    if (!text || text.length > 5000) return jsonError("Posts must contain 1–5,000 characters.", 400);
    const post = await authorizedPost(postId, account.id);
    if (!post || Number(post.userId) !== account.id) return jsonError("You can only edit your own posts.", 403);
    await getDatabase().execute("UPDATE networking_posts SET body = ? WHERE id = ? AND user_id = ?", [text, postId, account.id]);
    return NextResponse.json({ updated: true });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("The career feed is unavailable.", 503);
    console.error("Editing a feed post failed.", error);
    return jsonError("We couldn't edit your post.", 500);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to delete your post.", 401);
    const postId = parsePositiveId((await params).id);
    if (!postId) return jsonError("Post not found.", 404);
    const post = await authorizedPost(postId, account.id);
    if (!post || Number(post.userId) !== account.id) return jsonError("You can only delete your own posts.", 403);
    const connection = await getDatabase().getConnection();
    let keys: string[] = [];
    try {
      await connection.beginTransaction();
      const [uploads] = await connection.execute<RowDataPacket[]>(
        "SELECT storage_key AS storageKey FROM networking_uploads WHERE post_id = ?",
        [postId],
      );
      keys = uploads.map((upload) => String(upload.storageKey));
      await connection.execute("DELETE FROM networking_posts WHERE id = ? AND user_id = ?", [postId, account.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await Promise.all(keys.map((key) => removeStoredUpload(key).catch((error) => {
      console.error("Deleting a feed attachment from disk failed.", error);
    })));
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("The career feed is unavailable.", 503);
    console.error("Deleting a feed post failed.", error);
    return jsonError("We couldn't delete your post.", 500);
  }
}
