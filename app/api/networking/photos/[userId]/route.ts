import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";
import { parsePositiveId, readStoredUpload } from "@/lib/networking";

export const runtime = "nodejs";

type PhotoRow = RowDataPacket & {
  storageKey: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  visibility: "private" | "public" | null;
  moderationHidden: number | null;
};

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId: rawUserId } = await params;
    const userId = parsePositiveId(rawUserId);
    if (userId === null) return jsonError("Photo not found.", 404);
    const account = await getCurrentAccount();
    const [rows] = await getDatabase().execute<PhotoRow[]>(
      `SELECT photo.storage_key AS storageKey, photo.mime_type AS mimeType,
              profile.visibility, profile.moderation_hidden AS moderationHidden
       FROM networking_profile_photos photo
       LEFT JOIN networking_profiles profile ON profile.user_id = photo.user_id
       WHERE photo.user_id = ? LIMIT 1`,
      [userId],
    );
    const photo = rows[0];
    if (!photo) return jsonError("Photo not found.", 404);
    const isOwner = account?.id === userId;
    const isAdmin = account?.role === "admin";
    if (!isOwner && !isAdmin && (photo.visibility !== "public" || photo.moderationHidden)) {
      return jsonError("Photo not found.", 404);
    }
    if (account && !isOwner) {
      const [blocked] = await getDatabase().execute<RowDataPacket[]>(
        `SELECT 1 FROM networking_blocks
         WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
         LIMIT 1`,
        [account.id, userId, userId, account.id],
      );
      if (blocked.length) return jsonError("Photo not found.", 404);
    }
    const bytes = await readStoredUpload(photo.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Profile photos are unavailable. Check the database setup.", 503);
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return jsonError("Photo not found.", 404);
    }
    console.error("Loading a profile photo failed.", error);
    return jsonError("We couldn't load this photo.", 500);
  }
}
