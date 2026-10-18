import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import {
  readBoundedFormData,
  detectImageMimeType,
  removeStoredUpload,
  storeUpload,
  UploadRequestError,
} from "@/lib/networking";

export const runtime = "nodejs";

const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ExistingPhotoRow = RowDataPacket & { storageKey: string };

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  let storageKey: string | null = null;
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to update your photo.", 401);
    const form = await readBoundedFormData(request);
    const file = form.get("photo");
    if (!(file instanceof File) || file.size < 1) return jsonError("Choose a photo to upload.", 400);
    if (file.size > 5 * 1024 * 1024) return jsonError("Your photo must be 5 MB or smaller.", 413);
    const declaredMimeType = PHOTO_MIME_TYPES.find((mimeType) => mimeType === file.type);
    if (!declaredMimeType) {
      return jsonError("Upload a JPEG, PNG, or WebP image.", 415);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = detectImageMimeType(bytes);
    if (bytes.byteLength !== file.size || mimeType !== declaredMimeType) {
      return jsonError("The image format could not be verified. Choose a valid JPEG, PNG, or WebP photo.", 415);
    }

    const stored = await storeUpload(file);
    storageKey = stored.storageKey;
    const connection = await getDatabase().getConnection();
    let previousStorageKey: string | null = null;
    try {
      await connection.beginTransaction();
      await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [account.id]);
      const [existingRows] = await connection.execute<ExistingPhotoRow[]>(
        "SELECT storage_key AS storageKey FROM networking_profile_photos WHERE user_id = ? FOR UPDATE",
        [account.id],
      );
      previousStorageKey = existingRows[0]?.storageKey ?? null;
      await connection.execute<ResultSetHeader>(
        `INSERT INTO networking_profile_photos (user_id, storage_key, mime_type, byte_size)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE storage_key = VALUES(storage_key), mime_type = VALUES(mime_type),
                                 byte_size = VALUES(byte_size), updated_at = CURRENT_TIMESTAMP`,
        [account.id, storageKey, mimeType, file.size],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (previousStorageKey) {
      await removeStoredUpload(previousStorageKey).catch((error) => {
        console.error("Removing a replaced profile photo failed.", error);
      });
    }
    return NextResponse.json({ photoUrl: `/api/networking/photos/${account.id}` });
  } catch (error) {
    if (storageKey) {
      await removeStoredUpload(storageKey).catch((cleanupError) => {
        console.error("Cleaning up an unsuccessful profile photo upload failed.", cleanupError);
      });
    }
    if (error instanceof UploadRequestError) return jsonError(error.message, error.status);
    if (isDatabaseUnavailable(error)) return jsonError("Profile photos are unavailable. Check the database setup.", 503);
    console.error("Updating a profile photo failed.", error);
    return jsonError("We couldn't update your photo.", 500);
  }
}

export async function DELETE(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to remove your photo.", 401);
    const connection = await getDatabase().getConnection();
    let storageKey: string | null = null;
    try {
      await connection.beginTransaction();
      await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [account.id]);
      const [rows] = await connection.execute<ExistingPhotoRow[]>(
        "SELECT storage_key AS storageKey FROM networking_profile_photos WHERE user_id = ? FOR UPDATE",
        [account.id],
      );
      storageKey = rows[0]?.storageKey ?? null;
      await connection.execute("DELETE FROM networking_profile_photos WHERE user_id = ?", [account.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (storageKey) await removeStoredUpload(storageKey);
    return NextResponse.json({ removed: true });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Profile photos are unavailable. Check the database setup.", 503);
    console.error("Removing a profile photo failed.", error);
    return jsonError("We couldn't remove your photo.", 500);
  }
}
