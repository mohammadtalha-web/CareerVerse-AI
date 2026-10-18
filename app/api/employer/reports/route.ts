import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

type CountRow = RowDataPacket & { status: string; total: number };
type MonthRow = RowDataPacket & { month: string; total: number };
type SalaryRow = RowDataPacket & {
  currency: string;
  period: string;
  totalRoles: number;
  minPosted: number;
  maxPosted: number;
};

export async function GET() {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to view company reports.", 401);
    if (account.role !== "recruiter" || !account.recruiterVerified) {
      return jsonError("A verified recruiter account is required.", 403);
    }
    const database = getDatabase();
    const [pipeline] = await database.execute<CountRow[]>(
      `SELECT a.status, COUNT(*) AS total
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE j.employer_id = ? AND j.source_id IS NULL
       GROUP BY a.status ORDER BY a.status`,
      [account.id],
    );
    const [openings] = await database.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM jobs
       WHERE employer_id = ? AND source_id IS NULL AND status = 'published'
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
      [account.id],
    );
    const [monthlyApplications] = await database.execute<MonthRow[]>(
      `SELECT DATE_FORMAT(a.created_at, '%Y-%m') AS month, COUNT(*) AS total
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE j.employer_id = ? AND j.source_id IS NULL
         AND a.created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
       GROUP BY DATE_FORMAT(a.created_at, '%Y-%m')
       ORDER BY month`,
      [account.id],
    );
    const [salaryRanges] = await database.execute<SalaryRow[]>(
      `SELECT salary_currency AS currency, salary_period AS period, COUNT(*) AS totalRoles,
              MIN(salary_min) AS minPosted, MAX(salary_max) AS maxPosted
       FROM jobs
       WHERE employer_id = ? AND source_id IS NULL AND status = 'published'
         AND salary_currency IS NOT NULL AND salary_period IS NOT NULL
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       GROUP BY salary_currency, salary_period ORDER BY salary_currency, salary_period`,
      [account.id],
    );
    return NextResponse.json(
      {
        openings: Number(openings[0]?.total ?? 0),
        pipeline: pipeline.map((row) => ({ status: row.status, total: Number(row.total) })),
        monthlyApplications: monthlyApplications.map((row) => ({ month: row.month, total: Number(row.total) })),
        advertisedSalaryRanges: salaryRanges.map((row) => ({
          currency: row.currency,
          period: row.period,
          roles: Number(row.totalRoles),
          minimum: Number(row.minPosted),
          maximum: Number(row.maxPosted),
        })),
        source: "CareerVerse records for this employer's roles and applications.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Company reports are unavailable. Apply migration 005.", 503);
    console.error("Loading employer reports failed.", error);
    return jsonError("We couldn't load company reports.", 500);
  }
}
