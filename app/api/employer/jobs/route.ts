import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { notifyMembersAboutJob } from "@/lib/notifications";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEmploymentType(
  value: unknown,
): value is "full_time" | "part_time" | "contract" | "internship" | "temporary" {
  return (
    value === "full_time" ||
    value === "part_time" ||
    value === "contract" ||
    value === "internship" ||
    value === "temporary"
  );
}

function isWorkplaceType(value: unknown): value is "onsite" | "hybrid" | "remote" {
  return value === "onsite" || value === "hybrid" || value === "remote";
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function createSlug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 135) || "career-opportunity";
  return `${base}-${randomBytes(6).toString("hex")}`;
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  let account;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Employer tools are unavailable. Check the database setup.", 503);
    console.error("Unable to verify the job-publishing account.", error);
    return jsonError("We couldn't verify your account.", 500);
  }
  if (!account) return jsonError("Sign in to post a role.", 401);
  if (account.role !== "recruiter" || !account.recruiterVerified) {
    return jsonError("A verified recruiter account is required to publish jobs.", 403);
  }

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send the job details as JSON.", 415);
  }
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > 32_768) return jsonError("The request is too large.", 413);
  let text: string;
  try {
    text = await request.text();
  } catch {
    return jsonError("The request body could not be read.", 400);
  }
  if (Buffer.byteLength(text, "utf8") > 32_768) return jsonError("The request is too large.", 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }
  if (!isRecord(body)) return jsonError("Job details are required.", 400);

  const title = cleanText(body.title, 160);
  const company = cleanText(body.company, 160);
  const location = cleanText(body.location, 180);
  const countryCode = typeof body.countryCode === "string" ? body.countryCode.trim().toUpperCase() : "";
  const employmentType = body.employmentType;
  const workplaceType = body.workplaceType;
  const experience = cleanText(body.experience, 120) ?? "";
  const salary = cleanText(body.salary, 160) ?? "";
  const salaryMin = body.salaryMin === "" || body.salaryMin === null ? null : Number(body.salaryMin);
  const salaryMax = body.salaryMax === "" || body.salaryMax === null ? null : Number(body.salaryMax);
  const salaryCurrency = typeof body.salaryCurrency === "string" && body.salaryCurrency.trim()
    ? body.salaryCurrency.trim().toUpperCase()
    : null;
  const salaryPeriod = typeof body.salaryPeriod === "string" && body.salaryPeriod ? body.salaryPeriod : null;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const requirementsInput = Array.isArray(body.requirements) ? body.requirements : null;
  const requirements = requirementsInput
    ? requirementsInput
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
    : [];

  if (
    !title ||
    title.length < 3 ||
    !company ||
    !location ||
    !/^[A-Z]{2}$/.test(countryCode) ||
    !isEmploymentType(employmentType) ||
    !isWorkplaceType(workplaceType) ||
    ((salaryMin !== null || salaryMax !== null) &&
      (salaryCurrency === null || !/^[A-Z]{3}$/.test(salaryCurrency) ||
        !["hour", "month", "year"].includes(salaryPeriod ?? "") ||
        salaryMin === null || salaryMax === null)) ||
    (salaryMin !== null && (!Number.isFinite(salaryMin) || salaryMin < 0 || salaryMin > 99_999_999_999.99)) ||
    (salaryMax !== null && (!Number.isFinite(salaryMax) || salaryMax < 0 || salaryMax > 99_999_999_999.99)) ||
    (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin) ||
    (salaryCurrency !== null && !/^[A-Z]{3}$/.test(salaryCurrency)) ||
    (salaryPeriod !== null && !["hour", "month", "year"].includes(salaryPeriod)) ||
    description.length < 30 ||
    description.length > 20_000 ||
    requirements.length < 1 ||
    requirements.length > 30 ||
    requirements.some((item) => !item || item.length > 500) ||
    !requirementsInput ||
    requirementsInput.length !== requirements.length
  ) {
    return jsonError("Complete all required job details with valid values.", 400);
  }

  try {
    const slug = createSlug(title);
    const [result] = await getDatabase().execute(
      `INSERT INTO jobs (
        employer_id, slug, title, company_name, location, country_code,
        employment_type, workplace_type, experience, salary, salary_min, salary_max,
        salary_currency, salary_period, description,
        requirements, status, is_sample, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', FALSE, CURRENT_TIMESTAMP)`,
      [
        account.id,
        slug,
        title,
        company,
        location,
        countryCode,
        employmentType,
        workplaceType,
        experience,
        salary,
        salaryMin,
        salaryMax,
        salaryCurrency,
        salaryPeriod,
        description,
        JSON.stringify(requirements),
      ],
    );
    const jobId = Number((result as { insertId?: number }).insertId);
    if (!Number.isSafeInteger(jobId) || jobId < 1) {
      throw new Error("The published job did not return a valid identifier.");
    }
    await notifyMembersAboutJob(jobId);
    return NextResponse.json({ slug, status: "published" }, { status: 201 });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Job publishing is unavailable. Check the database schema.", 503);
    console.error("Employer job publishing failed.", error);
    return jsonError("We couldn't publish this role. Please try again.", 500);
  }
}
