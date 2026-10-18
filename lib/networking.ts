import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolConnection } from "mysql2/promise";
import { getDatabase } from "@/lib/db";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_COUNT = 5;
export const MAX_MULTIPART_BYTES = 27 * 1024 * 1024;

export class UploadRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "UploadRequestError";
  }
}

export function normalizePair(first: number, second: number): [number, number] {
  return first < second ? [first, second] : [second, first];
}

export function parsePositiveId(value: unknown): number | null {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function uploadDirectory(): string {
  const configured = process.env.CAREERVERSE_UPLOAD_DIR?.trim();
  const directory = path.resolve(/*turbopackIgnore: true*/ configured || path.join(process.cwd(), "var", "uploads"));
  const publicDirectory = path.resolve(process.cwd(), "public");
  if (directory === publicDirectory || directory.startsWith(`${publicDirectory}${path.sep}`)) {
    throw new Error("CAREERVERSE_UPLOAD_DIR must be outside the public web directory.");
  }
  return directory;
}

export async function storeUpload(file: File): Promise<{ storageKey: string }> {
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Each file must be between 1 byte and 5 MB.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("The uploaded file size could not be verified.");
  }
  const storageKey = randomUUID();
  const directory = uploadDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, /*turbopackIgnore: true*/ storageKey), bytes, { flag: "wx", mode: 0o600 });
  return { storageKey };
}

export async function removeStoredUpload(storageKey: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(storageKey)) {
    throw new Error("Invalid stored upload identifier.");
  }
  await unlink(path.join(uploadDirectory(), /*turbopackIgnore: true*/ storageKey)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function readStoredUpload(storageKey: string): Promise<Buffer> {
  if (!/^[0-9a-f-]{36}$/i.test(storageKey)) {
    throw new Error("Invalid stored upload identifier.");
  }
  return readFile(path.join(uploadDirectory(), /*turbopackIgnore: true*/ storageKey));
}

export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export function detectImageMimeType(bytes: Buffer): ImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export async function readBoundedFormData(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(contentType) || !/\bboundary=/i.test(contentType)) {
    throw new UploadRequestError("Send the upload as multipart form data.", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new UploadRequestError("The upload size could not be verified.", 400);
    }
    if (length > MAX_MULTIPART_BYTES) {
      throw new UploadRequestError("Combined file upload size must be 25 MB or less.", 413);
    }
  }
  if (!request.body) throw new UploadRequestError("The upload is empty.", 400);
  const reader = request.body.getReader();
  const chunks: BlobPart[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_MULTIPART_BYTES) {
      await reader.cancel();
      throw new UploadRequestError("Combined file upload size must be 25 MB or less.", 413);
    }
    const chunk = new Uint8Array(value.byteLength);
    chunk.set(value);
    chunks.push(chunk.buffer);
  }
  try {
    return await new Response(new Blob(chunks), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new UploadRequestError("The multipart upload is invalid.", 400);
  }
}

export async function rollback(connection: PoolConnection): Promise<void> {
  await connection.rollback();
  connection.release();
}

export function safeDownloadName(name: string): string {
  return name.replace(/[\r\n"]/g, "_").slice(0, 255) || "download";
}

export function contentDisposition(name: string, disposition: "attachment" | "inline" = "attachment"): string {
  const safeName = safeDownloadName(name);
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="download"; filename*=UTF-8''${encoded}`;
}

export function database() {
  return getDatabase();
}
