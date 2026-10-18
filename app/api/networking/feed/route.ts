import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { decodeTimeIdCursor, encodeTimeIdCursor } from "@/lib/time-id-cursor";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_COUNT,
  readBoundedFormData,
  removeStoredUpload,
  safeDownloadName,
  storeUpload,
  UploadRequestError,
} from "@/lib/networking";

type PostRow = RowDataPacket & {
  id: number;
  userId: number;
  author: string;
  slug: string | null;
  headline: string | null;
  photoUrl: string | null;
  body: string;
  linkUrl: string | null;
  createdAt: Date;
  cursorTimestamp: string;
  commentCount: number;
  reactionCount: number;
  viewerReaction: string | null;
  moderationHidden: number;
};
type UploadRow = RowDataPacket & {
  id: number;
  postId: number;
  originalName: string;
  byteSize: number;
};

export async function GET(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to view the career feed.", 401);
    const searchParams = new URL(request.url).searchParams;
    const scope = searchParams.get("scope") ?? "all";
    if (scope !== "all" && scope !== "connections") {
      return jsonError("The feed scope is invalid.", 400);
    }
    const cursorValue = searchParams.get("cursor");
    const cursor = decodeTimeIdCursor(cursorValue);
    if (cursorValue && !cursor) return jsonError("The feed cursor is invalid.", 400);
    const cursorCondition = cursor
      ? "AND (post.created_at < ? OR (post.created_at = ? AND post.id < ?))"
      : "";
    const scopeCondition = scope === "connections"
      ? `AND EXISTS (
           SELECT 1 FROM networking_connections accepted_connection
           WHERE accepted_connection.status = 'accepted'
             AND (
               (accepted_connection.user_low_id = ? AND accepted_connection.user_high_id = post.user_id)
               OR (accepted_connection.user_high_id = ? AND accepted_connection.user_low_id = post.user_id)
             )
         )`
      : "";
    const [rows] = await getDatabase().execute<PostRow[]>(
      `SELECT post.id, post.user_id AS userId, member_user.full_name AS author,
              CASE WHEN profile.visibility = 'public' OR post.user_id = ? THEN profile.profile_slug ELSE NULL END AS slug,
              CASE WHEN profile.visibility = 'public' OR post.user_id = ? THEN profile.headline ELSE NULL END AS headline,
              CASE WHEN (profile.visibility = 'public' AND profile.moderation_hidden = FALSE) OR post.user_id = ?
                   THEN CASE WHEN profile_photo.user_id IS NULL THEN NULL
                             ELSE CONCAT('/api/networking/photos/', post.user_id) END
                   ELSE NULL END AS photoUrl,
              post.body,
              post.moderation_hidden AS moderationHidden,
              post.link_url AS linkUrl, post.created_at AS createdAt,
              DATE_FORMAT(post.created_at, '%Y-%m-%d %H:%i:%s.%f') AS cursorTimestamp,
              (SELECT COUNT(*) FROM networking_comments feed_comment WHERE feed_comment.post_id = post.id
               AND NOT EXISTS (
                 SELECT 1 FROM networking_blocks hidden_commenter
                 WHERE (hidden_commenter.blocker_id = ? AND hidden_commenter.blocked_id = feed_comment.user_id)
                    OR (hidden_commenter.blocker_id = feed_comment.user_id AND hidden_commenter.blocked_id = ?)
               )) AS commentCount,
              (SELECT COUNT(*) FROM networking_reactions reaction WHERE reaction.post_id = post.id) AS reactionCount,
              (SELECT reaction FROM networking_reactions ownReaction
               WHERE ownReaction.post_id = post.id AND ownReaction.user_id = ?) AS viewerReaction
       FROM networking_posts post
       JOIN users member_user ON member_user.id = post.user_id
       LEFT JOIN networking_profiles profile ON profile.user_id = post.user_id
       LEFT JOIN networking_profile_photos profile_photo ON profile_photo.user_id = post.user_id
       WHERE NOT EXISTS (
         SELECT 1 FROM networking_blocks block
         WHERE (block.blocker_id = ? AND block.blocked_id = post.user_id)
            OR (block.blocker_id = post.user_id AND block.blocked_id = ?)
       )
         AND (post.moderation_hidden = FALSE OR post.user_id = ?)
       ${scopeCondition}
       ${cursorCondition}
       ORDER BY post.created_at DESC, post.id DESC LIMIT 41`,
      [
        account.id,
        account.id,
        account.id,
        account.id,
        account.id,
        account.id,
        account.id,
        account.id,
        account.id,
        ...(scope === "connections" ? [account.id, account.id] : []),
        ...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.id] : []),
      ],
    );
    const hasMore = rows.length > 40;
    const pageRows = rows.slice(0, 40);
    const postIds = pageRows.map((row) => Number(row.id));
    const uploadsByPost = new Map<number, UploadRow[]>();
    if (postIds.length) {
      const [uploads] = await getDatabase().execute<UploadRow[]>(
        `SELECT id, post_id AS postId, original_name AS originalName, byte_size AS byteSize
         FROM networking_uploads WHERE post_id IN (${postIds.map(() => "?").join(",")})
         ORDER BY id`,
        postIds,
      );
      for (const upload of uploads) {
        const group = uploadsByPost.get(Number(upload.postId)) ?? [];
        group.push(upload);
        uploadsByPost.set(Number(upload.postId), group);
      }
    }
    const posts = pageRows.map((row) => ({ ...row, moderationHidden: Boolean(row.moderationHidden), uploads: uploadsByPost.get(Number(row.id)) ?? [] }));
    const lastPost = pageRows.at(-1);
    const nextCursor = hasMore && lastPost
      ? encodeTimeIdCursor(lastPost.cursorTimestamp, Number(lastPost.id))
      : null;
    const [photoRows] = await getDatabase().execute<RowDataPacket[]>(
      "SELECT user_id FROM networking_profile_photos WHERE user_id = ? LIMIT 1",
      [account.id],
    );
    const accountPhotoUrl = photoRows.length ? `/api/networking/photos/${account.id}` : null;
    return NextResponse.json({ posts, nextCursor, accountPhotoUrl });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("The career feed is unavailable. Check the database setup.", 503);
    console.error("Loading the career feed failed.", error);
    return jsonError("We couldn't load the career feed.", 500);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  const stored: Array<{ storageKey: string; file: File }> = [];
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to publish a feed post.", 401);
    const form = await readBoundedFormData(request);
    const body = String(form.get("body") ?? "").trim();
    const linkValue = String(form.get("linkUrl") ?? "").trim();
    if (!body || body.length > 5000) return jsonError("Posts must contain 1–5,000 characters.", 400);
    let linkUrl: string | null = null;
    if (linkValue) {
      let parsed: URL;
      try { parsed = new URL(linkValue); } catch { return jsonError("Post links must be valid HTTP or HTTPS URLs.", 400); }
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        return jsonError("Post links must be valid HTTP or HTTPS URLs.", 400);
      }
      linkUrl = parsed.toString();
    }
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length > MAX_UPLOAD_COUNT) return jsonError(`Attach no more than ${MAX_UPLOAD_COUNT} files.`, 400);
    if (files.some((file) => file.size > MAX_UPLOAD_BYTES)) return jsonError("Each attachment must be 5 MB or smaller.", 413);
    if (files.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) {
      return jsonError("Combined attachment size must be 25 MB or less.", 413);
    }
    for (const file of files) {
      const upload = await storeUpload(file);
      stored.push({ storageKey: upload.storageKey, file });
    }
    const connection = await getDatabase().getConnection();
    let postId: number;
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        "INSERT INTO networking_posts (user_id, body, link_url) VALUES (?, ?, ?)",
        [account.id, body, linkUrl],
      );
      postId = result.insertId;
      for (const upload of stored) {
        await connection.execute(
          `INSERT INTO networking_uploads (user_id, post_id, storage_key, original_name, byte_size)
           VALUES (?, ?, ?, ?, ?)`,
          [account.id, postId, upload.storageKey, safeDownloadName(upload.file.name), upload.file.size],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return NextResponse.json({ id: postId }, { status: 201 });
  } catch (error) {
    await Promise.all(stored.map(({ storageKey }) => removeStoredUpload(storageKey).catch((cleanupError) => {
      console.error("Cleaning up an unsuccessful feed upload failed.", cleanupError);
    })));
    if (error instanceof UploadRequestError) return jsonError(error.message, error.status);
    if (isDatabaseUnavailable(error)) return jsonError("The career feed is unavailable. Check the database setup.", 503);
    console.error("Publishing a feed post failed.", error);
    return jsonError("We couldn't publish your post.", 500);
  }
}
