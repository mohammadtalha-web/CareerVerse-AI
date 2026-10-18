import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import {
  MAX_MULTIPART_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_COUNT,
  normalizePair,
  parsePositiveId,
  readBoundedFormData,
  isRecord,
  removeStoredUpload,
  safeDownloadName,
  storeUpload,
  UploadRequestError,
} from "@/lib/networking";
import { notifyAfterEvent } from "@/lib/notifications";

type ConversationRow = RowDataPacket & {
  id: number;
  otherUserId: number;
  fullName: string;
  profileSlug: string | null;
  headline: string | null;
  lastMessage: string | null;
  updatedAt: Date;
};
type MessageRow = RowDataPacket & {
  id: number;
  senderId: number;
  senderName: string;
  body: string;
  createdAt: Date;
};
type MessageUploadRow = RowDataPacket & {
  id: number;
  messageId: number;
  originalName: string;
  byteSize: number;
};

export async function GET(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to use messages.", 401);
    const { searchParams } = new URL(request.url);
    const conversationId = parsePositiveId(searchParams.get("conversationId"));
    const database = getDatabase();
    if (!conversationId) {
      const [conversations] = await database.execute<ConversationRow[]>(
        `SELECT c.id, other.id AS otherUserId, other.full_name AS fullName,
                profile.profile_slug AS profileSlug, profile.headline,
                (SELECT COALESCE(NULLIF(m.body, ''), 'Attachment') FROM networking_messages m
                 WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessage,
                c.updated_at AS updatedAt
         FROM networking_conversations c
         JOIN users other ON other.id = IF(c.user_low_id = ?, c.user_high_id, c.user_low_id)
         LEFT JOIN networking_profiles profile ON profile.user_id = other.id
         WHERE (c.user_low_id = ? OR c.user_high_id = ?)
           AND EXISTS (
             SELECT 1 FROM networking_connections connection
             WHERE connection.user_low_id = c.user_low_id AND connection.user_high_id = c.user_high_id
               AND connection.status = 'accepted'
           )
           AND NOT EXISTS (
             SELECT 1 FROM networking_blocks block
             WHERE (block.blocker_id = ? AND block.blocked_id = other.id)
                OR (block.blocker_id = other.id AND block.blocked_id = ?)
           )
         ORDER BY c.updated_at DESC LIMIT 50`,
        [account.id, account.id, account.id, account.id, account.id],
      );
      return NextResponse.json({ conversations });
    }
    const [rows] = await database.execute<RowDataPacket[]>(
      `SELECT c.id, c.user_low_id AS userLowId, c.user_high_id AS userHighId
       FROM networking_conversations c
       WHERE c.id = ? AND (c.user_low_id = ? OR c.user_high_id = ?)
         AND EXISTS (
           SELECT 1 FROM networking_connections connection
           WHERE connection.user_low_id = c.user_low_id AND connection.user_high_id = c.user_high_id
             AND connection.status = 'accepted'
         )
         AND NOT EXISTS (
           SELECT 1 FROM networking_blocks block
           WHERE (block.blocker_id = ? AND block.blocked_id = IF(c.user_low_id = ?, c.user_high_id, c.user_low_id))
              OR (block.blocker_id = IF(c.user_low_id = ?, c.user_high_id, c.user_low_id) AND block.blocked_id = ?)
         )
       LIMIT 1`,
      [conversationId, account.id, account.id, account.id, account.id, account.id, account.id],
    );
    if (!rows.length) return jsonError("Messages are available only between accepted connections.", 403);
    const conversation = rows[0] as { userLowId: number; userHighId: number };
    const otherUserId = Number(conversation.userLowId) === account.id
      ? Number(conversation.userHighId)
      : Number(conversation.userLowId);
    await database.execute(
      `UPDATE notifications SET read_at = UTC_TIMESTAMP(3)
       WHERE user_id = ? AND actor_user_id = ? AND notification_type = 'message' AND read_at IS NULL`,
      [account.id, otherUserId],
    );
    const [messages] = await database.execute<MessageRow[]>(
      `SELECT m.id, m.sender_id AS senderId, u.full_name AS senderName, m.body, m.created_at AS createdAt
       FROM networking_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
      [conversationId],
    );
    const orderedMessages = messages.reverse();
    const messageIds = orderedMessages.map((message) => Number(message.id));
    const uploadsByMessage = new Map<number, MessageUploadRow[]>();
    if (messageIds.length) {
      const [uploads] = await database.execute<MessageUploadRow[]>(
        `SELECT id, message_id AS messageId, original_name AS originalName, byte_size AS byteSize
         FROM networking_uploads WHERE message_id IN (${messageIds.map(() => "?").join(",")})
         ORDER BY id`,
        messageIds,
      );
      for (const upload of uploads) {
        const group = uploadsByMessage.get(Number(upload.messageId)) ?? [];
        group.push(upload);
        uploadsByMessage.set(Number(upload.messageId), group);
      }
    }
    return NextResponse.json({
      messages: orderedMessages.map((message) => ({
        ...message,
        uploads: uploadsByMessage.get(Number(message.id)) ?? [],
      })),
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Messaging is unavailable. Check the database setup.", 503);
    console.error("Loading messages failed.", error);
    return jsonError("We couldn't load your messages.", 500);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  const stored: Array<{ storageKey: string; file: File }> = [];
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to send a message.", 401);
    let recipientId: number | null;
    let message: string;
    let files: File[];
    const contentType = request.headers.get("content-type") ?? "";
    if (/^multipart\/form-data\b/i.test(contentType)) {
      const form = await readBoundedFormData(request);
      recipientId = parsePositiveId(form.get("recipientId"));
      message = String(form.get("body") ?? "").trim();
      files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    } else {
      let body: unknown;
      try { body = await request.json(); } catch { return jsonError("Message details are required.", 400); }
      if (!isRecord(body)) return jsonError("Message details are required.", 400);
      recipientId = parsePositiveId(body.recipientId);
      message = typeof body.body === "string" ? body.body.trim() : "";
      files = [];
    }
    if (!recipientId || recipientId === account.id || message.length > 4000 || (!message && files.length === 0)) {
      return jsonError("Choose a connection and enter a message of at most 4,000 characters or attach a file.", 400);
    }
    if (files.length > MAX_UPLOAD_COUNT) {
      return jsonError(`Attach no more than ${MAX_UPLOAD_COUNT} files.`, 400);
    }
    if (files.some((file) => file.size > MAX_UPLOAD_BYTES)) {
      return jsonError("Each attachment must be 5 MB or smaller.", 413);
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_MULTIPART_BYTES - 2 * 1024 * 1024) {
      return jsonError("Combined attachment size must be 25 MB or less.", 413);
    }
    const [userLowId, userHighId] = normalizePair(account.id, recipientId);
    const database = getDatabase();
    const connection = await database.getConnection();
    let conversationId: number;
    let messageId: number;
    try {
      await connection.beginTransaction();
      const [relationships] = await connection.execute<RowDataPacket[]>(
        `SELECT 1 FROM networking_connections relationship
         WHERE relationship.user_low_id = ? AND relationship.user_high_id = ? AND relationship.status = 'accepted'
           AND NOT EXISTS (
             SELECT 1 FROM networking_blocks block
             WHERE (block.blocker_id = ? AND block.blocked_id = ?)
                OR (block.blocker_id = ? AND block.blocked_id = ?)
           ) LIMIT 1 FOR UPDATE`,
        [userLowId, userHighId, account.id, recipientId, recipientId, account.id],
      );
      if (!relationships.length) {
        await connection.rollback();
        return jsonError("Messaging is available only with accepted, unblocked connections.", 403);
      }
      for (const file of files) {
        const upload = await storeUpload(file);
        stored.push({ storageKey: upload.storageKey, file });
      }
      const [conversation] = await connection.execute<ResultSetHeader>(
        `INSERT INTO networking_conversations (user_low_id, user_high_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [userLowId, userHighId],
      );
      conversationId = conversation.insertId;
      const [result] = await connection.execute<ResultSetHeader>(
        "INSERT INTO networking_messages (conversation_id, sender_id, body) VALUES (?, ?, ?)",
        [conversationId, account.id, message],
      );
      messageId = result.insertId;
      for (const upload of stored) {
        await connection.execute(
          `INSERT INTO networking_uploads
           (user_id, message_id, storage_key, original_name, byte_size)
           VALUES (?, ?, ?, ?, ?)`,
          [
            account.id,
            messageId,
            upload.storageKey,
            safeDownloadName(upload.file.name),
            upload.file.size,
          ],
        );
      }
      await connection.execute(
        "UPDATE networking_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [conversationId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await notifyAfterEvent({
      userId: recipientId,
      actorUserId: account.id,
      type: "message",
      title: "New message",
      body: `${account.fullName} sent you a message.`,
      href: `/networking/messages?user=${account.id}`,
      dedupeKey: `message:${messageId}`,
    });
    return NextResponse.json({ conversationId, messageId }, { status: 201 });
  } catch (error) {
    await Promise.all(stored.map(({ storageKey }) => removeStoredUpload(storageKey).catch((cleanupError) => {
      console.error("Removing an incomplete message attachment failed.", cleanupError);
    })));
    if (error instanceof UploadRequestError) return jsonError(error.message, error.status);
    if (error instanceof Error && /between 1 byte and 5 MB|uploaded file size/.test(error.message)) {
      return jsonError(error.message, 413);
    }
    if (isDatabaseUnavailable(error)) return jsonError("Messaging is unavailable. Check the database setup.", 503);
    console.error("Sending a message failed.", error);
    return jsonError("We couldn't send your message.", 500);
  }
}
