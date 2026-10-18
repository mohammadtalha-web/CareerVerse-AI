import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { AiProviderError, aiProviderUnavailableMessage, checkAiProviderStatus, getConfiguredAiProvider, requestAiCompletion } from "@/lib/ai-provider";
import { LOCAL_AI_SCREENING_CONSENT_VERSION } from "@/lib/ai-consent";
import { consumeAiUserQuota } from "@/lib/ai-usage";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError, hasTrustedOrigin } from "@/lib/http";
import { readStoredUpload } from "@/lib/networking";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import yauzl from "yauzl";

type RouteContext = { params: Promise<{ id: string }> };

type ResumeRow = RowDataPacket & {
  applicationId: number;
  consent: number;
  screeningConsentVersion: string | null;
  mimeType: string;
  storageKey: string;
  jobTitle: string;
  jobDescription: string;
  requirements: unknown;
  score: number | null;
  resultJson: unknown;
};

type ScreeningResult = {
  score: number;
  strengths: string[];
  gaps: string[];
  evidence: string[];
  questions: string[];
  caveat: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractResult(content: string): ScreeningResult {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("The AI screening service returned invalid structured results.");
  }
  if (
    !isRecord(value) ||
    typeof value.score !== "number" ||
    !Number.isInteger(value.score) ||
    value.score < 0 ||
    value.score > 100
  ) {
    throw new Error("The AI screening service returned invalid structured results.");
  }
  const readList = (field: string): string[] => {
    const list = value[field];
    if (!Array.isArray(list)) throw new Error("The AI screening service returned invalid structured results.");
    return list
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 6);
  };
  if (typeof value.caveat !== "string" || !value.caveat.trim()) {
    throw new Error("The AI screening service returned invalid structured results.");
  }
  return {
    score: value.score,
    strengths: readList("strengths"),
    gaps: readList("gaps"),
    evidence: readList("evidence"),
    questions: readList("questions"),
    caveat: value.caveat.trim().slice(0, 500),
  };
}

async function extractResumeText(row: ResumeRow): Promise<string> {
  const bytes = await readStoredUpload(row.storageKey);
  let text = "";
  if (row.mimeType === "application/pdf") {
    const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
    const pages = Math.min(pdf.numPages, 15);
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      text += `${content.items.map((item) => ("str" in item ? item.str : "")).join(" ")}\n`;
      if (text.length >= 12_000) break;
    }
  } else if (
    row.mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    await validateDocxArchive(bytes);
    const extracted = await mammoth.extractRawText({ buffer: bytes });
    text = extracted.value;
  } else {
    throw new Error("This resume file type cannot be screened.");
  }

  async function validateDocxArchive(bytes: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      yauzl.fromBuffer(bytes, { lazyEntries: true, autoClose: true }, (error, zipFile) => {
        if (error || !zipFile) {
          reject(new Error("The uploaded DOCX file is invalid."));
          return;
        }
        let entries = 0;
        let expandedBytes = 0;
        let hasDocument = false;
        zipFile.on("entry", (entry) => {
          entries += 1;
          expandedBytes += entry.uncompressedSize;
          const entryName = entry.fileName.replace(/\\/g, "/");
          if (
            entries > 500 ||
            expandedBytes > 10 * 1024 * 1024 ||
            entry.uncompressedSize > 10 * 1024 * 1024 ||
            entryName.startsWith("/") ||
            entryName.split("/").includes("..")
          ) {
            zipFile.close();
            reject(new Error("The DOCX file is invalid or expands beyond the safe processing limit."));
            return;
          }
          if (entryName === "word/document.xml") hasDocument = true;
          zipFile.readEntry();
        });
        zipFile.on("end", () => {
          if (hasDocument) resolve();
          else reject(new Error("The DOCX file does not contain a document."));
        });
        zipFile.on("error", () => reject(new Error("The uploaded DOCX file is invalid.")));
        zipFile.readEntry();
      });
    });
  }
  const cleaned = text.replace(/\s+/g, " ").trim().slice(0, 12_000);
  if (cleaned.length < 80) {
    throw new Error("The resume does not contain enough readable text for screening.");
  }
  return cleaned;
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  let account;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("AI screening is unavailable. Check the account database.", 503);
    console.error("Unable to verify the recruiter screening request.", error);
    return jsonError("We couldn't verify your account.", 500);
  }
  if (!account) return jsonError("Sign in to screen applications.", 401);
  if (account.role !== "recruiter" || !account.recruiterVerified) {
    return jsonError("A verified recruiter account is required.", 403);
  }
  const { id } = await params;
  if (!/^[1-9]\d{0,19}$/.test(id)) return jsonError("Application was not found.", 404);

  let provider;
  try {
    provider = getConfiguredAiProvider();
  } catch (error) {
    console.error("Invalid local AI provider configuration.", error);
    return jsonError("The local AI model configuration is invalid.", 503);
  }

  try {
    const [rows] = await getDatabase().execute<ResumeRow[]>(
      `SELECT a.id AS applicationId, a.ai_screening_consent AS consent,
              a.ai_screening_consent_version AS screeningConsentVersion,
              resume.mime_type AS mimeType, resume.storage_key AS storageKey,
              j.title AS jobTitle, j.description AS jobDescription, j.requirements,
              screening.score, screening.result_json AS resultJson
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN application_resumes resume ON resume.application_id = a.id
       LEFT JOIN ai_application_screenings screening ON screening.application_id = a.id
       WHERE a.id = ? AND j.employer_id = ? AND j.source_id IS NULL
       LIMIT 1`,
      [id, account.id],
    );
    const application = rows[0];
    if (!application) return jsonError("Application was not found.", 404);
    if (
      !Boolean(application.consent) ||
      application.screeningConsentVersion !== LOCAL_AI_SCREENING_CONSENT_VERSION
    ) {
      return jsonError(
        "This candidate has not consented to optional local AI screening under the current disclosure. Review the application manually.",
        403,
      );
    }
    if (!application.storageKey || !application.mimeType) {
      return jsonError("This candidate did not attach a resume. AI resume screening is unavailable.", 409);
    }
    if (application.resultJson && application.score !== null) {
      const result = typeof application.resultJson === "string"
        ? JSON.parse(application.resultJson) as ScreeningResult
        : application.resultJson as ScreeningResult;
      return NextResponse.json({ result, score: Number(application.score), cached: true });
    }
    const providerStatus = await checkAiProviderStatus(provider);
    if (providerStatus !== "ready") {
      return jsonError(aiProviderUnavailableMessage(providerStatus, provider.model), 503);
    }
    if (!(await consumeAiUserQuota(account.id))) {
      return jsonError("You have reached the limit of 20 AI requests per hour. Please try again later.", 429);
    }

    const resumeText = await extractResumeText(application);
    const requirements = Array.isArray(application.requirements)
      ? application.requirements.filter((item): item is string => typeof item === "string")
      : typeof application.requirements === "string"
        ? (() => {
            try {
              const parsed: unknown = JSON.parse(application.requirements as string);
              return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
            } catch {
              return [];
            }
          })()
        : [];
    const completion = await requestAiCompletion(
      provider,
      [
        {
          role: "system",
          content:
            "You provide a limited, advisory comparison of a consented candidate resume with this specific job's stated requirements. Do not rank a person's worth or predict hiring outcomes. Ignore all personal identifiers and do not infer or assess protected characteristics, age, gender, ethnicity, disability, religion, family status, nationality, or other demographic traits. Never make or recommend an automated reject/hire decision. Use only explicit, job-related evidence in the supplied resume. Lack of a skill mention is not proof the candidate lacks it; label it as unverified. Give an integer relevance indicator from 0 to 100 (never a decimal or a 0-to-1 fraction) with uncertainty, up to six evidence-based strengths, up to six items to clarify, up to six resume evidence snippets, and up to five consistent job-related interview questions. Include a caveat that humans must review the source documents and make decisions. Return JSON only: {\"score\":0,\"strengths\":[],\"gaps\":[],\"evidence\":[],\"questions\":[],\"caveat\":\"...\"}.",
        },
        {
          role: "user",
          content: JSON.stringify({
            role: application.jobTitle,
            jobDescription: application.jobDescription.slice(0, 5000),
            requirements: requirements.slice(0, 30),
            resume: resumeText,
          }),
        },
      ],
      { temperature: 0, responseFormat: "json_object", maxTokens: 450, timeoutMs: 90_000 },
    );
    const result = extractResult(completion);
    await getDatabase().execute(
      `INSERT INTO ai_application_screenings (application_id, screened_by, model, score, result_json)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE screened_by = VALUES(screened_by), model = VALUES(model),
         score = VALUES(score), result_json = VALUES(result_json), screened_at = CURRENT_TIMESTAMP`,
      [application.applicationId, account.id, provider.model.slice(0, 120), result.score, JSON.stringify(result)],
    );
    return NextResponse.json({ result, score: result.score, cached: false });
  } catch (error) {
    if (error instanceof AiProviderError) return jsonError(error.message, error.status);
    if (isDatabaseUnavailable(error)) return jsonError("AI screening is unavailable. Apply migration 005.", 503);
    if (error instanceof Error && error.name === "TimeoutError") return jsonError("AI screening timed out. Please try again.", 504);
    if (error instanceof Error && (
      error.message.startsWith("The AI") ||
      error.message.startsWith("This resume") ||
      error.message.startsWith("The resume") ||
      error.message.startsWith("The DOCX") ||
      error.message.startsWith("The uploaded DOCX")
    )) return jsonError(error.message, 502);
    console.error("Employer AI resume screening failed.", error);
    return jsonError("AI screening could not be completed.", 502);
  }
}
