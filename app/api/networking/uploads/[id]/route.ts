import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";
import { contentDisposition, detectImageMimeType, readStoredUpload } from "@/lib/networking";

export const runtime = "nodejs";

type UploadRow = RowDataPacket & {
  storageKey: string;
  originalName: string;
  userId: number;
  portfolioId: number | null;
  postId: number | null;
  messageId: number | null;
  visibility: string | null;
  profileHidden: number | null;
  postHidden: number | null;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await getCurrentAccount();
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 1) return jsonError("Attachment not found.", 404);
    const [rows] = await getDatabase().execute<UploadRow[]>(
      `SELECT u.storage_key AS storageKey, u.original_name AS originalName, u.user_id AS userId,
              u.portfolio_id AS portfolioId, u.post_id AS postId,
              u.message_id AS messageId,
              p.visibility, p.moderation_hidden AS profileHidden,
              post.moderation_hidden AS postHidden
       FROM networking_uploads u
       LEFT JOIN networking_profiles p ON p.user_id = u.user_id
       LEFT JOIN networking_posts post ON post.id = u.post_id
       WHERE u.id = ? LIMIT 1`,
      [id],
    );
    const upload = rows[0];
    if (!upload) return jsonError("Attachment not found.", 404);
    if (upload.portfolioId !== null && upload.userId !== account?.id && upload.visibility !== "public") {
      return jsonError("Attachment not found.", 404);
    }
    if (upload.portfolioId !== null && upload.profileHidden && upload.userId !== account?.id && account?.role !== "admin") {
      return jsonError("Attachment not found.", 404);
    }
    if (upload.postId !== null && !account) return jsonError("Sign in to view feed attachments.", 401);
    if (upload.postId !== null && upload.postHidden && upload.userId !== account?.id && account?.role !== "admin") {
      return jsonError("Attachment not found.", 404);
    }
    if (upload.messageId !== null) {
      if (!account) return jsonError("Sign in to view message attachments.", 401);
      const [conversations] = await getDatabase().execute<RowDataPacket[]>(
        `SELECT 1 FROM networking_messages message
         JOIN networking_conversations conversation ON conversation.id = message.conversation_id
         WHERE message.id = ?
           AND (conversation.user_low_id = ? OR conversation.user_high_id = ?)
           AND EXISTS (
             SELECT 1 FROM networking_connections relationship
             WHERE relationship.user_low_id = conversation.user_low_id
               AND relationship.user_high_id = conversation.user_high_id
               AND relationship.status = 'accepted'
           )
           AND NOT EXISTS (
             SELECT 1 FROM networking_blocks block
             WHERE (block.blocker_id = ? AND block.blocked_id = IF(conversation.user_low_id = ?, conversation.user_high_id, conversation.user_low_id))
                OR (block.blocker_id = IF(conversation.user_low_id = ?, conversation.user_high_id, conversation.user_low_id) AND block.blocked_id = ?)
           )
         LIMIT 1`,
        [upload.messageId, account.id, account.id, account.id, account.id, account.id, account.id],
      );
      if (!conversations.length) return jsonError("Attachment not found.", 404);
    }
    if (account && account.id !== upload.userId) {
      const [blocked] = await getDatabase().execute<RowDataPacket[]>(
        `SELECT 1 FROM networking_blocks
         WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
         LIMIT 1`,
        [account.id, upload.userId, upload.userId, account.id],
      );
      if (blocked.length) return jsonError("Attachment not found.", 404);
    }
    const bytes = await readStoredUpload(upload.storageKey);
    const inlinePreview = new URL(request.url).searchParams.get("inline") === "1";
    const imageMimeType = inlinePreview ? detectImageMimeType(bytes) : null;
    if (inlinePreview && !imageMimeType) {
      return jsonError("This attachment is not a supported image.", 415);
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": imageMimeType ?? "application/octet-stream",
        "Content-Disposition": contentDisposition(upload.originalName, imageMimeType ? "inline" : "attachment"),
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Attachments are unavailable. Check the database setup.", 503);
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return jsonError("Attachment is no longer available.", 404);
    }
    console.error("Downloading a networking attachment failed.", error);
    return jsonError("We couldn't download this attachment.", 500);
  }
}
