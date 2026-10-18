import type { Metadata } from "next";
import Link from "next/link";
import type { RowDataPacket } from "mysql2";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable } from "@/lib/http";

export const metadata: Metadata = { title: "Verified companies" };
export const dynamic = "force-dynamic";

type CompanyRow = RowDataPacket & {
  slug: string;
  companyName: string;
  industry: string;
  headquarters: string;
  employeeCount: number | null;
};

export default async function CompaniesPage() {
  let companies: CompanyRow[] = [];
  let error = "";
  try {
    const [rows] = await getDatabase().execute<CompanyRow[]>(
      `SELECT slug, company_name AS companyName, industry, headquarters,
              employee_count AS employeeCount
      FROM company_profiles profile
      JOIN users owner ON owner.id = profile.owner_user_id
      WHERE owner.role = 'recruiter' AND owner.recruiter_verified = TRUE
      ORDER BY company_name LIMIT 200`,
    );
    companies = rows;
  } catch (caught) {
    if (isDatabaseUnavailable(caught)) error = "The verified company directory is unavailable. Please try again later.";
    else {
      console.error("Loading verified companies failed.", caught);
      error = "We couldn't load the verified company directory.";
    }
  }
  return (
    <main className="jobs-page"><div className="wrap account-page">
      <header className="companies-heading"><span className="section-kicker">REAL VERIFIED EMPLOYERS</span><h1>Company directory</h1><p>Company information is provided by verified CareerVerse recruiter accounts. Workforce counts are self-reported.</p></header>
      {error ? <section className="card card-pad"><p className="account-form-error" role="alert">{error}</p></section> : companies.length ? (
        <div className="companies-list">{companies.map((company) => <Link className="company-directory-card" href={`/companies/${encodeURIComponent(company.slug)}`} key={company.slug}>
          <span className="company-directory-mark">{company.companyName.slice(0, 2).toUpperCase()}</span>
          <span><strong>{company.companyName}</strong><small>{[company.industry, company.headquarters, company.employeeCount === null ? "" : `${company.employeeCount.toLocaleString()} self-reported employees`].filter(Boolean).join(" · ")}</small></span>
          <span aria-hidden="true">→</span>
        </Link>)}</div>
      ) : <section className="card card-pad"><h2>No verified company profiles yet</h2><p>Company profiles appear here when a verified recruiter publishes one.</p><Link className="btn btn-line" href="/employer/jobs">Employer workspace</Link></section>}
    </div></main>
  );
}
