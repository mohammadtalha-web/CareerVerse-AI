import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

type CompanyRow = RowDataPacket & {
  slug: string;
  companyName: string;
  industry: string;
  headquarters: string;
  employeeCount: number | null;
};

export async function GET() {
  try {
    const [companies] = await getDatabase().execute<CompanyRow[]>(
      `SELECT slug, company_name AS companyName, industry, headquarters,
              employee_count AS employeeCount
      FROM company_profiles profile
      JOIN users owner ON owner.id = profile.owner_user_id
      WHERE owner.role = 'recruiter' AND owner.recruiter_verified = TRUE
      ORDER BY company_name LIMIT 200`,
    );
    return NextResponse.json({ companies }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("The verified company directory is unavailable.", 503);
    console.error("Loading the company directory failed.", error);
    return jsonError("We couldn't load the company directory.", 500);
  }
}
