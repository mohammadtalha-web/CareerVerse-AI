import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { RowDataPacket } from "mysql2";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable } from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };
type CompanyRow = RowDataPacket & {
  id: number;
  ownerUserId: number;
  companyName: string;
  industry: string;
  headquarters: string;
  websiteUrl: string | null;
  description: string;
  employeeCount: number | null;
  employeeCountAsOf: Date | string | null;
};
type JobRow = RowDataPacket & {
  slug: string;
  title: string;
  location: string;
  employmentType: string;
  workplaceType: string;
  salary: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  createdAt: Date | string;
};
type SalaryRow = RowDataPacket & {
  currency: string;
  period: string;
  roles: number;
  minimum: number;
  maximum: number;
};

async function findCompany(slug: string): Promise<CompanyRow | null> {
  const [rows] = await getDatabase().execute<CompanyRow[]>(
    `    SELECT profile.id, profile.owner_user_id AS ownerUserId,
           profile.company_name AS companyName, profile.industry, profile.headquarters,
           profile.website_url AS websiteUrl, profile.description,
           profile.employee_count AS employeeCount, profile.employee_count_as_of AS employeeCountAsOf
    FROM company_profiles profile
    JOIN users owner ON owner.id = profile.owner_user_id
    WHERE profile.slug = ? AND owner.role = 'recruiter' AND owner.recruiter_verified = TRUE
    LIMIT 1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function generateMetadata({ params }: RouteContext): Promise<Metadata> {
  const { slug } = await params;
  try {
    const company = await findCompany(slug);
    return { title: company?.companyName ?? "Company profile" };
  } catch (error) {
    if (!isDatabaseUnavailable(error)) console.error("Loading company metadata failed.", error);
    return { title: "Company profile" };
  }
}

export default async function CompanyProfilePage({ params }: RouteContext) {
  const { slug } = await params;
  let company: CompanyRow | null;
  let jobs: JobRow[] = [];
  let salaryRanges: SalaryRow[] = [];
  let totalApplications = 0;
  try {
    company = await findCompany(slug);
    if (!company) notFound();
    const database = getDatabase();
    const [jobRows] = await database.execute<JobRow[]>(
      `SELECT slug, title, location, employment_type AS employmentType,
              workplace_type AS workplaceType, salary,
              salary_min AS salaryMin, salary_max AS salaryMax,
              salary_currency AS salaryCurrency, salary_period AS salaryPeriod,
              created_at AS createdAt
       FROM jobs
       WHERE employer_id = ? AND source_id IS NULL AND status = 'published'
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY published_at DESC, id DESC LIMIT 100`,
      [company.ownerUserId],
    );
    jobs = jobRows;
    const [salaryRows] = await database.execute<SalaryRow[]>(
      `SELECT salary_currency AS currency, salary_period AS period, COUNT(*) AS roles,
              MIN(salary_min) AS minimum, MAX(salary_max) AS maximum
       FROM jobs
       WHERE employer_id = ? AND source_id IS NULL AND status = 'published'
         AND salary_currency IS NOT NULL AND salary_period IS NOT NULL
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       GROUP BY salary_currency, salary_period ORDER BY salary_currency, salary_period`,
      [company.ownerUserId],
    );
    salaryRanges = salaryRows;
    const [applicationRows] = await database.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE j.employer_id = ? AND j.source_id IS NULL`,
      [company.ownerUserId],
    );
    totalApplications = Number(applicationRows[0]?.total ?? 0);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    if (isDatabaseUnavailable(error)) {
      return <main className="jobs-page"><div className="wrap account-page"><section className="card card-pad">
        <h1>Company profile unavailable</h1><p>The company directory is temporarily unavailable. Please try again later.</p><Link href="/companies">Back to companies</Link>
      </section></div></main>;
    }
    console.error("Loading the verified company profile failed.", error);
    return <main className="jobs-page"><div className="wrap account-page"><section className="card card-pad">
      <h1>Company profile unavailable</h1><p>We couldn&apos;t load this company profile.</p><Link href="/companies">Back to companies</Link>
    </section></div></main>;
  }
  if (!company) notFound();
  const dateReported = company.employeeCountAsOf
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(company.employeeCountAsOf))
    : null;
  return (
    <main className="jobs-page"><div className="wrap account-page">
      <div className="crumbs"><Link href="/companies">Companies</Link><span aria-hidden="true">/</span><b>{company.companyName}</b></div>
      <section className="company-real-profile card card-pad">
        <span className="company-directory-mark">{company.companyName.slice(0, 2).toUpperCase()}</span>
        <div><span className="section-kicker">VERIFIED EMPLOYER</span><h1>{company.companyName}</h1>
          <p>{[company.industry, company.headquarters].filter(Boolean).join(" · ") || "Company details provided by the verified employer."}</p>
          {company.websiteUrl && <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer">{company.websiteUrl}</a>}
          {company.employeeCount !== null && <p>{Number(company.employeeCount).toLocaleString()} self-reported employees{dateReported ? ` · reported ${dateReported}` : ""}</p>}
        </div>
      </section>
      <div className="company-real-grid">
        <div className="company-real-main">
          <section className="card card-pad employer-job-section"><h2>About {company.companyName}</h2>
            <p className="company-real-description">{company.description || "The employer has not added a company description yet."}</p>
          </section>
          <section className="card card-pad employer-job-section"><h2>Current opportunities ({jobs.length})</h2>
            {jobs.length ? <div className="account-job-list">{jobs.map((job) => <article className="account-job-item" key={job.slug}>
              <div><Link href={`/jobs/${encodeURIComponent(job.slug)}`}>{job.title}</Link>
                <span>{job.location} · {job.employmentType.replace("_", "-")} · {job.workplaceType}
                  {job.salaryCurrency && job.salaryMin !== null && job.salaryMax !== null
                    ? ` · ${job.salaryCurrency} ${Number(job.salaryMin).toLocaleString()}–${Number(job.salaryMax).toLocaleString()} / ${job.salaryPeriod}`
                    : ""}</span>
                {job.salary && <small>{job.salary}</small>}
              </div>
              <Link className="btn btn-line" href={`/jobs/${encodeURIComponent(job.slug)}`}>View role</Link>
            </article>)}</div> : <p>No currently published openings.</p>}
          </section>
        </div>
        <aside className="company-real-side">
          <section className="card card-pad employer-job-section"><span className="section-kicker">CAREERVERSE ACTIVITY</span><h2>Recruitment activity</h2>
            <p>{jobs.length} current live {jobs.length === 1 ? "opening" : "openings"} and {totalApplications} applications recorded for this employer&apos;s CareerVerse roles.</p>
            <small>Application counts describe activity on CareerVerse only, not the employer&apos;s complete hiring or workforce data.</small>
          </section>
          <section className="card card-pad employer-job-section"><span className="section-kicker">EMPLOYER-PROVIDED PAY</span><h2>Advertised compensation</h2>
            {salaryRanges.length ? salaryRanges.map((range) => <p key={`${range.currency}-${range.period}`}>
              <strong>{range.currency} {Number(range.minimum).toLocaleString()}–{Number(range.maximum).toLocaleString()} / {range.period}</strong>
              <br /><small>Advertised range across {range.roles} live {range.roles === 1 ? "role" : "roles"}; not independently verified.</small>
            </p>) : <p>No structured salary ranges have been provided for current openings.</p>}
          </section>
        </aside>
      </div>
    </div></main>
  );
}
