import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { normalizePair, parsePositiveId, isRecord } from "@/lib/networking";
import { decodeTimeIdCursor, encodeTimeIdCursor } from "@/lib/time-id-cursor";
import { notifyAfterEvent } from "@/lib/notifications";

type ConnectionRow = RowDataPacket & {
  userId: number;
  fullName: string;
  profileSlug: string | null;
  headline: string | null;
  photoUrl: string | null;
  requesterId: number;
  status: "pending" | "accepted" | "rejected";
  createdAt: Date;
  cursorTimestamp: string;
};

type Category = "incoming" | "outgoing" | "accepted" | "blocked";
type ConnectionPage = { members: Omit<ConnectionRow, "cursorTimestamp">[]; nextCursor: string | null };

async function getCategoryPage(
  accountId: number,
  category: Category,
  cursorValue: string | null,
  selectedUserId: number | null,
): Promise<ConnectionPage> {
  const cursor = decodeTimeIdCursor(cursorValue);
  if (cursorValue && !cursor) throw new Error("The connection cursor is invalid.");
  const database = getDatabase();
  if (category === "blocked") {
    const cursorCondition = cursor
      ? "AND (block.created_at < ? OR (block.created_at = ? AND block.blocked_id < ?))"
      : "";
    const [rows] = await database.execute<ConnectionRow[]>(
      `SELECT user.id AS userId, user.full_name AS fullName,
              profile.profile_slug AS profileSlug, profile.headline,
              CASE WHEN profile.visibility = 'public' AND profile.moderation_hidden = FALSE
                        AND photo.user_id IS NOT NULL
                   THEN CONCAT('/api/networking/photos/', user.id) ELSE NULL END AS photoUrl,
              block.blocked_id AS requesterId, 'rejected' AS status,
              block.created_at AS createdAt,
              DATE_FORMAT(block.created_at, '%Y-%m-%d %H:%i:%s.%f') AS cursorTimestamp
       FROM networking_blocks block
       JOIN users user ON user.id = block.blocked_id
       LEFT JOIN networking_profiles profile ON profile.user_id = user.id
       LEFT JOIN networking_profile_photos photo ON photo.user_id = user.id
       WHERE block.blocker_id = ? ${cursorCondition}
       ORDER BY block.created_at DESC, block.blocked_id DESC LIMIT 51`,
      [accountId, ...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.id] : [])],
    );
    return pageFromRows(rows);
  }

  const categoryCondition: Record<Exclude<Category, "blocked">, string> = {
    incoming: "connection.status = 'pending' AND connection.requester_id <> ?",
    outgoing: "connection.status = 'pending' AND connection.requester_id = ?",
    accepted: "connection.status = 'accepted'",
  };
  const categoryValues = category === "accepted" ? [] : [accountId];
  const cursorCondition = cursor
    ? "AND (connection.updated_at < ? OR (connection.updated_at = ? AND other.id < ?))"
    : "";
  const selectedUserCondition = selectedUserId ? "AND other.id = ?" : "";
  const [rows] = await database.execute<ConnectionRow[]>(
    `SELECT other.id AS userId, other.full_name AS fullName,
            profile.profile_slug AS profileSlug, profile.headline,
            CASE WHEN profile.visibility = 'public' AND profile.moderation_hidden = FALSE
                      AND photo.user_id IS NOT NULL
                 THEN CONCAT('/api/networking/photos/', other.id) ELSE NULL END AS photoUrl,
            connection.requester_id AS requesterId, connection.status,
            connection.updated_at AS createdAt,
            DATE_FORMAT(connection.updated_at, '%Y-%m-%d %H:%i:%s.%f') AS cursorTimestamp
     FROM networking_connections connection
     JOIN users other ON other.id = IF(connection.user_low_id = ?, connection.user_high_id, connection.user_low_id)
     LEFT JOIN networking_profiles profile ON profile.user_id = other.id
     LEFT JOIN networking_profile_photos photo ON photo.user_id = other.id
     WHERE (connection.user_low_id = ? OR connection.user_high_id = ?)
       AND ${categoryCondition[category]}
       ${selectedUserCondition}
       AND NOT EXISTS (
         SELECT 1 FROM networking_blocks block
         WHERE (block.blocker_id = ? AND block.blocked_id = other.id)
            OR (block.blocker_id = other.id AND block.blocked_id = ?)
       )
       ${cursorCondition}
     ORDER BY connection.updated_at DESC, other.id DESC LIMIT 51`,
    [
      accountId,
      accountId,
      accountId,
      ...categoryValues,
      ...(selectedUserId ? [selectedUserId] : []),
      accountId,
      accountId,
      ...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.id] : []),
    ],
  );
  return pageFromRows(rows);
}

function pageFromRows(rows: ConnectionRow[]): ConnectionPage {
  const hasMore = rows.length > 50;
  const pageRows = rows.slice(0, 50);
  const last = pageRows.at(-1);
  const members = pageRows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    profileSlug: row.profileSlug,
    headline: row.headline,
    photoUrl: row.photoUrl,
    requesterId: row.requesterId,
    status: row.status,
    createdAt: row.createdAt,
  }));
  return {
    members,
    nextCursor: hasMore && last
      ? encodeTimeIdCursor(last.cursorTimestamp, Number(last.userId))
      : null,
  };
}

export async function GET(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to view your connections.", 401);
    const params = new URL(request.url).searchParams;
    const categoryValue = params.get("category");
    const cursor = params.get("cursor");
    const userIdValue = params.get("userId");
    const userId = userIdValue === null ? null : parsePositiveId(userIdValue);
    if (userIdValue !== null && (!userId || categoryValue !== "accepted")) {
      return jsonError("The selected connection is invalid.", 400);
    }
    if (categoryValue !== null) {
      const categories: Category[] = ["incoming", "outgoing", "accepted", "blocked"];
      const category = categories.find((item) => item === categoryValue);
      if (!category) {
        return jsonError("The connection category is invalid.", 400);
      }
      let page: ConnectionPage;
      try {
        page = await getCategoryPage(account.id, category, cursor, userId);
      } catch (error) {
        if (error instanceof Error && error.message === "The connection cursor is invalid.") {
          return jsonError(error.message, 400);
        }
        throw error;
      }
      return NextResponse.json(page);
    }
    const categories: Category[] = ["incoming", "outgoing", "accepted", "blocked"];
    const pages = await Promise.all(categories.map((category) =>
      getCategoryPage(account.id, category, null, null),
    ));
    const [incoming, outgoing, accepted, blocked] = pages.map((page) => page.members);
    return NextResponse.json({
      incoming,
      outgoing,
      accepted,
      blocked,
      nextCursors: Object.fromEntries(categories.map((category, index) => [category, pages[index].nextCursor])),
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Connections are unavailable. Check the database setup.", 503);
    console.error("Loading connections failed.", error);
    return jsonError("We couldn't load your connections.", 500);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to send a connection request.", 401);
    let body: unknown;
    try { body = await request.json(); } catch { return jsonError("A connection request is required.", 400); }
    const userId = isRecord(body) ? parsePositiveId(body.userId) : null;
    if (!userId || userId === account.id) return jsonError("Choose another CareerVerse member.", 400);
    const [pairLow, pairHigh] = normalizePair(account.id, userId);
    const connection = await getDatabase().getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute<RowDataPacket[]>(
        `SELECT user.id FROM users user
         JOIN networking_profiles profile ON profile.user_id = user.id AND profile.visibility = 'public'
         WHERE user.id = ? LIMIT 1`,
        [userId],
      );
      if (!users.length) {
        await connection.rollback();
        return jsonError("Only members with published profiles can receive connection requests.", 404);
      }
      const [blocked] = await connection.execute<RowDataPacket[]>(
        `SELECT 1 FROM networking_blocks
         WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
         LIMIT 1`,
        [account.id, userId, userId, account.id],
      );
      if (blocked.length) {
        await connection.rollback();
        return jsonError("This connection request can't be sent.", 403);
      }
      const [existingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT requester_id AS requesterId, status FROM networking_connections
         WHERE user_low_id = ? AND user_high_id = ? FOR UPDATE`,
        [pairLow, pairHigh],
      );
      const existing = existingRows[0];
      if (existing?.status === "accepted") {
        await connection.rollback();
        return jsonError("You are already connected.", 409);
      }
      if (existing?.status === "pending") {
        await connection.rollback();
        return jsonError("A connection request is already pending.", 409);
      }
      if (existing) {
        await connection.execute(
          `UPDATE networking_connections SET requester_id = ?, status = 'pending'
           WHERE user_low_id = ? AND user_high_id = ?`,
          [account.id, pairLow, pairHigh],
        );
      } else {
        await connection.execute(
          `INSERT INTO networking_connections (user_low_id, user_high_id, requester_id)
           VALUES (?, ?, ?)`,
          [pairLow, pairHigh, account.id],
        );
      }
      await connection.commit();
      await notifyAfterEvent({
        userId,
        actorUserId: account.id,
        type: "connection_request",
        title: "New connection request",
        body: `${account.fullName} wants to connect with you.`,
        href: "/networking/connections",
        dedupeKey: `connection-request:${pairLow}:${pairHigh}:${Date.now()}`,
      });
      return NextResponse.json({ requested: true }, { status: 201 });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Connections are unavailable. Check the database setup.", 503);
    console.error("Sending a connection request failed.", error);
    return jsonError("We couldn't send this connection request.", 500);
  }
}

export async function PATCH(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to manage connections.", 401);
    let body: unknown;
    try { body = await request.json(); } catch { return jsonError("Connection details are required.", 400); }
    if (!isRecord(body) || typeof body.action !== "string") return jsonError("Choose a connection action.", 400);
    const action = body.action;
    const userId = parsePositiveId(body.userId);
    if (!userId || userId === account.id) return jsonError("Choose another CareerVerse member.", 400);
    const [pairLow, pairHigh] = normalizePair(account.id, userId);
    const db = getDatabase();

    if (action === "unblock") {
      await db.execute("DELETE FROM networking_blocks WHERE blocker_id = ? AND blocked_id = ?", [account.id, userId]);
      return NextResponse.json({ unblocked: true });
    }
    if (action === "block") {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [users] = await connection.execute<RowDataPacket[]>("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!users.length) {
          await connection.rollback();
          return jsonError("Member not found.", 404);
        }
        await connection.execute(
          "INSERT IGNORE INTO networking_blocks (blocker_id, blocked_id) VALUES (?, ?)",
          [account.id, userId],
        );
        await connection.execute(
          "DELETE FROM networking_connections WHERE user_low_id = ? AND user_high_id = ?",
          [pairLow, pairHigh],
        );
        await connection.execute(
          "DELETE FROM networking_conversations WHERE user_low_id = ? AND user_high_id = ?",
          [pairLow, pairHigh],
        );
        await connection.commit();
        return NextResponse.json({ blocked: true });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    if (!["accept", "reject", "cancel", "remove"].includes(action)) {
      return jsonError("That connection action is not supported.", 400);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT requester_id AS requesterId, status FROM networking_connections
       WHERE user_low_id = ? AND user_high_id = ? LIMIT 1`,
      [pairLow, pairHigh],
    );
    const relationship = rows[0];
    if (!relationship) return jsonError("Connection request not found.", 404);
    if (action === "accept" || action === "reject") {
      if (relationship.status !== "pending" || Number(relationship.requesterId) === account.id) {
        return jsonError("Only the recipient can respond to a pending request.", 403);
      }
      const status = action === "accept" ? "accepted" : "rejected";
      await db.execute(
        "UPDATE networking_connections SET status = ? WHERE user_low_id = ? AND user_high_id = ?",
        [status, pairLow, pairHigh],
      );
      if (action === "accept") {
        await notifyAfterEvent({
          userId: Number(relationship.requesterId),
          actorUserId: account.id,
          type: "connection_accepted",
          title: "Connection request accepted",
          body: `${account.fullName} accepted your connection request.`,
          href: "/networking/connections",
          dedupeKey: `connection-accepted:${pairLow}:${pairHigh}:${Date.now()}`,
        });
      }
    } else if (action === "cancel") {
      if (relationship.status !== "pending" || Number(relationship.requesterId) !== account.id) {
        return jsonError("You can't cancel this request.", 403);
      }
      await db.execute("DELETE FROM networking_connections WHERE user_low_id = ? AND user_high_id = ?", [pairLow, pairHigh]);
    } else {
      if (relationship.status !== "accepted") return jsonError("You aren't connected to this member.", 409);
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute("DELETE FROM networking_connections WHERE user_low_id = ? AND user_high_id = ?", [pairLow, pairHigh]);
        await connection.execute("DELETE FROM networking_conversations WHERE user_low_id = ? AND user_high_id = ?", [pairLow, pairHigh]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Connections are unavailable. Check the database setup.", 503);
    console.error("Updating a connection failed.", error);
    return jsonError("We couldn't update this connection.", 500);
  }
}
