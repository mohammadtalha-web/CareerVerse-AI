import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { randomBytes } from "node:crypto";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

type CompanyRow = RowDataPacket & {
  slug: string;
  companyName: string;
  industry: string;
  headquarters: string;
  websiteUrl: string | null;
  description: string;
  employeeCount: number | null;
  employeeCountAsOf: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length > 0 && cleaned.length <= max ? cleaned : null;
}

function companySlug(value: string): string {
  const slug = value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 75) || "company";
  return `${slug}-${randomBytes(4).toString("hex")}`;
}

async function requireVerifiedRecruiter() {
  const account = await getCurrentAccount();
  if (!account) return { error: jsonError("Sign in to manage your company profile.", 401) };
  if (account.role !== "recruiter" || !account.recruiterVerified) {
    return { error: jsonError("A verified recruiter account is required.", 403) };
  }
  return { account };
}

export async function GET() {
  try {
    const result = await requireVerifiedRecruiter();
    if ("error" in result) return result.error;
    const [rows] = await getDatabase().execute<CompanyRow[]>(
      `SELECT profile.slug, profile.company_name AS companyName, profile.industry, profile.headquarters,
              profile.website_url AS websiteUrl, profile.description,
              profile.employee_count AS employeeCount, profile.employee_count_as_of AS employeeCountAsOf
       FROM company_profiles profile
       JOIN users owner ON owner.id = profile.owner_user_id
       WHERE profile.owner_user_id = ? AND owner.recruiter_verified = TRUE LIMIT 1`,
      [result.account.id],
    );
    return NextResponse.json({ profile: rows[0] ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Company profiles are unavailable. Apply migration 005.", 503);
    console.error("Loading the employer company profile failed.", error);
    return jsonError("We couldn't load the company profile.", 500);
  }
}

export async function PUT(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 12_000) return jsonError("The profile is too large.", 413);
    body = JSON.parse(text);
  } catch {
    return jsonError("Send a valid JSON company profile.", 400);
  }
  if (!isRecord(body)) return jsonError("Company profile details are required.", 400);
  const companyName = cleanText(body.companyName, 160);
  const industry = typeof body.industry === "string" ? body.industry.trim() : "";
  const headquarters = typeof body.headquarters === "string" ? body.headquarters.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const websiteUrl = typeof body.websiteUrl === "string" ? body.websiteUrl.trim() : "";
  const employeeCount = body.employeeCount === "" || body.employeeCount === null
    ? null
    : Number(body.employeeCount);
  if (
    !companyName ||
    industry.length > 120 ||
    headquarters.length > 180 ||
    description.length > 5_000 ||
    (employeeCount !== null && (!Number.isSafeInteger(employeeCount) || employeeCount < 0 || employeeCount > 10_000_000)) ||
    (websiteUrl && (() => {
      try {
        const parsed = new URL(websiteUrl);
        return parsed.protocol !== "https:" || Boolean(parsed.username || parsed.password);
      } catch {
        return true;
      }
    })())
  ) {
    return jsonError("Check the company profile fields and try again.", 400);
  }

  let result: Awaited<ReturnType<typeof requireVerifiedRecruiter>>;
  try {
    result = await requireVerifiedRecruiter();
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Company profiles are unavailable.", 503);
    console.error("Verifying employer access to the company profile failed.", error);
    return jsonError("We couldn't verify your account.", 500);
  }
  if ("error" in result) return result.error;
  try {
    const [existing] = await getDatabase().execute<RowDataPacket[]>(
      "SELECT id, slug FROM company_profiles WHERE owner_user_id = ? LIMIT 1",
      [result.account.id],
    );
    const slug = typeof existing[0]?.slug === "string" ? existing[0].slug : companySlug(companyName);
    if (existing[0]) {
      await getDatabase().execute(
        `UPDATE company_profiles
         SET company_name = ?, industry = ?, headquarters = ?, website_url = ?,
             description = ?, employee_count = ?, employee_count_as_of = IF(? IS NULL, NULL, CURRENT_DATE)
         WHERE owner_user_id = ?`,
        [companyName, industry, headquarters, websiteUrl || null, description, employeeCount, employeeCount, result.account.id],
      );
    } else {
      await getDatabase().execute(
        `INSERT INTO company_profiles
         (owner_user_id, slug, company_name, industry, headquarters, website_url, description, employee_count, employee_count_as_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, CURRENT_DATE))`,
        [result.account.id, slug, companyName, industry, headquarters, websiteUrl || null, description, employeeCount, employeeCount],
      );
    }
    return NextResponse.json({ saved: true, slug });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Company profiles are unavailable. Apply migration 005.", 503);
    console.error("Saving the employer company profile failed.", error);
    return jsonError("We couldn't save your company profile.", 500);
  }
}
