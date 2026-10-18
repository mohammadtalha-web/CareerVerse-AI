import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";
import { contentDisposition, readStoredUpload } from "@/lib/networking";

type RouteContext = { params: Promise<{ id: string }> };
type ResumeRow = RowDataPacket & {
  userId: number;
  employerId: number | null;
  storageKey: string;
  originalName: string;
  mimeType: string;
};

export async function GET(_request: Request, { params }: RouteContext) {
  let account;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Application documents are unavailable.", 503);
    console.error("Unable to verify resume download access.", error);
    return jsonError("We couldn't verify your account.", 500);
  }
  if (!account) return jsonError("Sign in to view this application document.", 401);
  const { id } = await params;
  if (!/^[1-9]\d{0,19}$/.test(id)) return jsonError("Resume was not found.", 404);

  try {
    const [rows] = await getDatabase().execute<ResumeRow[]>(
      `SELECT a.user_id AS userId, j.employer_id AS employerId,
              resume.storage_key AS storageKey, resume.original_name AS originalName,
              resume.mime_type AS mimeType
       FROM application_resumes resume
       JOIN applications a ON a.id = resume.application_id
       JOIN jobs j ON j.id = a.job_id
       WHERE resume.application_id = ? AND j.source_id IS NULL
       LIMIT 1`,
      [id],
    );
    const resume = rows[0];
    if (!resume) return jsonError("Resume was not found.", 404);
    const isOwner = Number(resume.userId) === account.id;
    const isEmployer =
      account.role === "recruiter" &&
      account.recruiterVerified &&
      Number(resume.employerId) === account.id;
    if (!isOwner && !isEmployer) return jsonError("You cannot access this resume.", 403);

    const bytes = await readStoredUpload(resume.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": resume.mimeType,
        "Content-Disposition": contentDisposition(resume.originalName),
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Application documents are unavailable.", 503);
    console.error("Downloading an application resume failed.", error);
    return jsonError("The application resume could not be downloaded.", 500);
  }
}
