import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { LOCAL_AI_SCREENING_CONSENT_VERSION } from "@/lib/ai-consent";
import { notifyAfterEvent } from "@/lib/notifications";
import {
  MAX_UPLOAD_BYTES,
  readBoundedFormData,
  removeStoredUpload,
  safeDownloadName,
  storeUpload,
  UploadRequestError,
} from "@/lib/networking";

type RouteContext = { params: Promise<{ slug: string }> };
type JobApplyRow = RowDataPacket & {
  id: number;
  employerId: number | null;
  title: string;
  sourceId: number | null;
  isSample: number;
  status: string;
  applicationUrl: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  let account;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Applications are unavailable. Check the database setup and try again.", 503);
    }
    console.error("Unable to verify the job application account.", error);
    return jsonError("We couldn't verify your account.", 500);
  }
  if (!account) return jsonError("Sign in to apply for this opportunity.", 401);
  if (account.role !== "job_seeker") {
    return jsonError("Only job seeker accounts can submit applications.", 403);
  }

  const uploaded: Array<{ storageKey: string; mimeType: string; file: File }> = [];
  let resumeToStore: { mimeType: string; file: File } | null = null;
  let coverLetter = "";
  let aiScreeningConsent = false;
  try {
    if (request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      const form = await readBoundedFormData(request);
      coverLetter = String(form.get("coverLetter") ?? "").trim();
      aiScreeningConsent = form.get("aiScreeningConsent") === "on";
      const resume = form.get("resume");
      if (resume instanceof File && resume.size > 0) {
        if (resume.size > MAX_UPLOAD_BYTES) return jsonError("Resume must be 5 MB or smaller.", 413);
        const filename = resume.name.toLowerCase();
        const bytes = new Uint8Array(await resume.slice(0, 8).arrayBuffer());
        let mimeType: string | null = null;
        if (
          (filename.endsWith(".pdf") || resume.type === "application/pdf") &&
          new TextDecoder().decode(bytes).startsWith("%PDF-")
        ) {
          mimeType = "application/pdf";
        } else if (
          (filename.endsWith(".docx") || resume.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") &&
          bytes[0] === 0x50 && bytes[1] === 0x4b
        ) {
          mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        }
        if (!mimeType) return jsonError("Upload a valid PDF or DOCX resume.", 400);
        resumeToStore = { mimeType, file: resume };
      }
    } else if (request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      const declaredSize = Number(request.headers.get("content-length") ?? "0");
      if (declaredSize > 8_192) return jsonError("The request is too large.", 413);
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return jsonError("The request body must be valid JSON.", 400);
      }
      coverLetter = isRecord(payload) && typeof payload.coverLetter === "string" ? payload.coverLetter.trim() : "";
    } else {
      return jsonError("Send the application as JSON or multipart form data.", 415);
    }
    if (coverLetter.length > 5_000) return jsonError("Cover letter must be 5,000 characters or fewer.", 400);
  } catch (error) {
    if (error instanceof UploadRequestError) return jsonError(error.message, error.status);
    if (error instanceof Error && (
      error.message.startsWith("Each file must") ||
      error.message.startsWith("The uploaded file size")
    )) return jsonError(error.message, 400);
    console.error("Reading application resume failed.", error);
    return jsonError("The application could not be processed.", 500);
  }

  const { slug } = await params;
  try {
    const [rows] = await getDatabase().execute<JobApplyRow[]>(
      `SELECT id, employer_id AS employerId, title, source_id AS sourceId, is_sample AS isSample, status,
              application_url AS applicationUrl
       FROM jobs
       WHERE slug = ? AND status = 'published' AND moderation_hidden = FALSE
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         AND (source_id IS NULL OR EXISTS (
           SELECT 1 FROM job_sources s
           WHERE s.id = jobs.source_id AND s.verified = TRUE AND s.enabled = TRUE
         ))
         AND (employer_id IS NULL OR EXISTS (
           SELECT 1 FROM users u
           WHERE u.id = jobs.employer_id AND u.role = 'recruiter' AND u.recruiter_verified = TRUE
         ))
       LIMIT 1`,
      [slug],
    );
    const job = rows[0];
    if (!job || Boolean(job.isSample)) return jsonError("This sample listing is not accepting applications.", 404);

    if (job.sourceId !== null) {
      if (!job.applicationUrl || !job.applicationUrl.startsWith("https://")) {
        return jsonError("The verified source has not provided a safe application link.", 409);
      }
      return NextResponse.json({
        action: "external_handoff",
        applicationUrl: job.applicationUrl,
        message: "This portal requires you to complete the application on its website.",
      });
    }

    if (resumeToStore) {
      const { storageKey } = await storeUpload(resumeToStore.file);
      uploaded.push({ storageKey, ...resumeToStore });
    }
    const connection = await getDatabase().getConnection();
    let applicationId = 0;
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<{ insertId: number } & import("mysql2").ResultSetHeader>(
        `INSERT INTO applications
           (user_id, job_id, cover_letter, ai_screening_consent, ai_screening_consent_at,
            ai_screening_consent_version)
         VALUES (?, ?, ?, ?, IF(?, CURRENT_TIMESTAMP(3), NULL), ?)`,
        [
          account.id,
          job.id,
          coverLetter,
          aiScreeningConsent,
          aiScreeningConsent,
          aiScreeningConsent ? LOCAL_AI_SCREENING_CONSENT_VERSION : null,
        ],
      );
      applicationId = result.insertId;
      if (uploaded[0]) {
        await connection.execute(
          `INSERT INTO application_resumes
           (application_id, user_id, storage_key, original_name, mime_type, byte_size)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [result.insertId, account.id, uploaded[0].storageKey, safeDownloadName(uploaded[0].file.name), uploaded[0].mimeType, uploaded[0].file.size],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
        await Promise.all(uploaded.map(({ storageKey }) => removeStoredUpload(storageKey)));
        return jsonError("You have already applied to this role.", 409);
      }
      throw error;
    } finally {
      connection.release();
    }
    if (job.employerId) {
      await notifyAfterEvent({
        userId: job.employerId,
        actorUserId: account.id,
        type: "application_received",
        title: "New job application",
        body: `A job seeker applied for ${job.title}.`,
        href: "/employer/applications",
        dedupeKey: `application-received:${applicationId}`,
      });
    }
    return NextResponse.json({ action: "applied", message: "Your application was submitted." }, { status: 201 });
  } catch (error) {
    await Promise.all(uploaded.map(({ storageKey }) => removeStoredUpload(storageKey).catch((cleanupError) => {
      console.error("Cleaning up an unsuccessful application resume failed.", cleanupError);
    })));
    if (isDatabaseUnavailable(error)) {
      return jsonError("Applications are unavailable. Check the database setup and try again.", 503);
    }
    console.error("Job application failed.", error);
    return jsonError("We couldn't submit your application. Please try again.", 500);
  }
}