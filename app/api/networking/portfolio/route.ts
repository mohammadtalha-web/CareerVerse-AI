import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_COUNT,
  readBoundedFormData,
  removeStoredUpload,
  safeDownloadName,
  storeUpload,
  UploadRequestError,
} from "@/lib/networking";

type PortfolioRow = RowDataPacket & {
  id: number;
  title: string;
  description: string;
  projectUrl: string | null;
  createdAt: Date;
};
type UploadRow = RowDataPacket & {
  id: number;
  portfolioId: number;
  originalName: string;
  byteSize: number;
};

export async function GET() {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to manage your portfolio.", 401);
    const [rows] = await getDatabase().execute<PortfolioRow[]>(
      `SELECT p.id, p.title, p.description, p.project_url AS projectUrl, p.created_at AS createdAt
       FROM networking_portfolio p WHERE p.user_id = ? ORDER BY p.created_at DESC`,
      [account.id],
    );
    const portfolioIds = rows.map((row) => Number(row.id));
    const uploadsByProject = new Map<number, UploadRow[]>();
    if (portfolioIds.length) {
      const [uploads] = await getDatabase().execute<UploadRow[]>(
        `SELECT id, portfolio_id AS portfolioId, original_name AS originalName, byte_size AS byteSize
         FROM networking_uploads WHERE portfolio_id IN (${portfolioIds.map(() => "?").join(",")})
         ORDER BY id`,
        portfolioIds,
      );
      for (const upload of uploads) {
        const group = uploadsByProject.get(Number(upload.portfolioId)) ?? [];
        group.push(upload);
        uploadsByProject.set(Number(upload.portfolioId), group);
      }
    }
    const portfolio = rows.map((row) => ({ ...row, uploads: uploadsByProject.get(Number(row.id)) ?? [] }));
    return NextResponse.json({ portfolio });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Portfolio storage is unavailable. Check the database setup.", 503);
    console.error("Loading portfolio items failed.", error);
    return jsonError("We couldn't load your portfolio.", 500);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  const stored: Array<{ storageKey: string; file: File }> = [];
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to add a portfolio project.", 401);
    const form = await readBoundedFormData(request);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const urlValue = String(form.get("projectUrl") ?? "").trim();
    if (!title || title.length > 160 || description.length > 3000) {
      return jsonError("Add a project title and a description of at most 3,000 characters.", 400);
    }
    let projectUrl: string | null = null;
    if (urlValue) {
      let parsed: URL;
      try { parsed = new URL(urlValue); } catch { return jsonError("Project links must be valid HTTPS URLs.", 400); }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        return jsonError("Project links must be valid HTTPS URLs.", 400);
      }
      projectUrl = parsed.toString();
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
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        "INSERT INTO networking_portfolio (user_id, title, description, project_url) VALUES (?, ?, ?, ?)",
        [account.id, title, description, projectUrl],
      );
      for (const upload of stored) {
        await connection.execute(
          `INSERT INTO networking_uploads (user_id, portfolio_id, storage_key, original_name, byte_size)
           VALUES (?, ?, ?, ?, ?)`,
          [account.id, result.insertId, upload.storageKey, safeDownloadName(upload.file.name), upload.file.size],
        );
      }
      await connection.commit();
      return NextResponse.json({ id: result.insertId }, { status: 201 });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    await Promise.all(stored.map(({ storageKey }) => removeStoredUpload(storageKey).catch((cleanupError) => {
      console.error("Cleaning up an unsuccessful portfolio upload failed.", cleanupError);
    })));
    if (error instanceof UploadRequestError) return jsonError(error.message, error.status);
    if (isDatabaseUnavailable(error)) return jsonError("Portfolio storage is unavailable. Check the database setup.", 503);
    console.error("Creating a portfolio item failed.", error);
    return jsonError("We couldn't save this project.", 500);
  }
}

export async function DELETE(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  let account;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Portfolio storage is unavailable.", 503);
    throw error;
  }
  if (!account) return jsonError("Sign in to remove a portfolio project.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("A project ID is required.", 400); }
  const id = body && typeof body === "object" && "id" in body ? Number(body.id) : 0;
  if (!Number.isSafeInteger(id) || id < 1) return jsonError("A valid project ID is required.", 400);

  try {
    const connection = await getDatabase().getConnection();
    let keys: string[] = [];
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT storage_key AS storageKey FROM networking_uploads WHERE portfolio_id = ? AND user_id = ?",
        [id, account.id],
      );
      keys = rows.map((row) => String(row.storageKey));
      const [result] = await connection.execute<ResultSetHeader>(
        "DELETE FROM networking_portfolio WHERE id = ? AND user_id = ?",
        [id, account.id],
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return jsonError("Portfolio project not found.", 404);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await Promise.all(keys.map((key) => removeStoredUpload(key).catch((error) => {
      console.error("Deleting a portfolio attachment from disk failed.", error);
    })));
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Portfolio storage is unavailable.", 503);
    console.error("Deleting a portfolio project failed.", error);
    return jsonError("We couldn't delete this project.", 500);
  }
}
