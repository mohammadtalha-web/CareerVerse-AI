import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { RowDataPacket } from "mysql2";
import EmployerJobForm from "@/components/EmployerJobForm";
import EmployerCompanyProfile from "@/components/EmployerCompanyProfile";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable } from "@/lib/http";

export const metadata: Metadata = { title: "Employer jobs" };
export const dynamic = "force-dynamic";

function formatPostedDate(date: Date): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

type EmployerJobRow = RowDataPacket & {
  slug: string;
  title: string;
  location: string;
  employmentType: string;
  workplaceType: string;
  status: string;
  createdAt: Date | string;
};

type EmployerJobCounts = {
  total: number;
  published: number;
  draft: number;
  closed: number;
};

export default async function EmployerJobsPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");

  if (account.role !== "recruiter") {
    return (
      <main className="jobs-page"><div className="wrap account-page"><section className="card card-pad">
        <h1>Employer workspace</h1><p>This area is for recruiter accounts.</p><Link className="btn btn-violet" href="/signup">Create a recruiter account</Link>
      </section></div></main>
    );
  }

  if (!account.recruiterVerified) {
    return (
      <main className="jobs-page"><div className="wrap account-page"><section className="card card-pad">
        <span className="section-kicker">EMPLOYER WORKSPACE</span><h1>Recruiter verification required</h1>
        <p>Your account is not yet approved to publish roles. Verification must be completed by a trusted CareerVerse administrator before job publishing is enabled.</p>
      </section></div></main>
    );
  }

  let jobs: EmployerJobRow[] = [];
  let counts: EmployerJobCounts | null = null;
  let error = "";
  try {
    const database = getDatabase();
    const [rows] = await database.execute<EmployerJobRow[]>(
      `SELECT slug, title, location, employment_type AS employmentType,
              workplace_type AS workplaceType, status, created_at AS createdAt
       FROM jobs WHERE employer_id = ? ORDER BY created_at DESC LIMIT 100`,
      [account.id],
    );
    const [countRows] = await database.execute<(RowDataPacket & EmployerJobCounts)[]>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 'published'), 0) AS published,
              COALESCE(SUM(status = 'draft'), 0) AS draft,
              COALESCE(SUM(status = 'closed'), 0) AS closed
       FROM jobs WHERE employer_id = ?`,
      [account.id],
    );
    jobs = rows;
    counts = countRows[0]
      ? {
          total: Number(countRows[0].total),
          published: Number(countRows[0].published),
          draft: Number(countRows[0].draft),
          closed: Number(countRows[0].closed),
        }
      : { total: 0, published: 0, draft: 0, closed: 0 };
  } catch (caught) {
    if (isDatabaseUnavailable(caught)) {
      error = "Job publishing is unavailable. Check that MySQL is running and database/schema.sql has been applied.";
    } else {
      console.error("Unable to load employer jobs.", caught);
      error = "We couldn't load your roles.";
    }
  }

  return (
    <main className="jobs-page">
      <div className="wrap account-page employer-workspace">
        <div className="crumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><b>Employer workspace</b></div>
        <header className="account-dashboard-hero employer-workspace-hero">
          <div className="account-dashboard-hero-copy">
            <span className="account-dashboard-kicker">EMPLOYER WORKSPACE</span>
            <h1>Manage your roles</h1>
            <p>Publish opportunities, keep your listings up to date, and review applicants in one place.</p>
          </div>
          <div className="account-dashboard-hero-side">
            <span className="account-role-badge"><span aria-hidden="true">●</span> Verified employer</span>
            <div className="employer-workspace-actions">
              <Link className="btn btn-violet" href="#publish-role">Publish a role</Link>
              <Link className="btn btn-line" href="/employer/applications">Review applications <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </header>
        {counts && (
          <div className="employer-overview-grid" aria-label="Role overview">
            <article className="employer-overview-card"><span className="employer-overview-icon overview-violet" aria-hidden="true">01</span><span className="employer-overview-label">Total roles</span><strong>{counts.total}</strong></article>
            <article className="employer-overview-card"><span className="employer-overview-icon overview-green" aria-hidden="true">02</span><span className="employer-overview-label">Live roles</span><strong>{counts.published}</strong></article>
            <article className="employer-overview-card"><span className="employer-overview-icon overview-amber" aria-hidden="true">03</span><span className="employer-overview-label">Drafts</span><strong>{counts.draft}</strong></article>
            <article className="employer-overview-card"><span className="employer-overview-icon overview-blue" aria-hidden="true">04</span><span className="employer-overview-label">Closed roles</span><strong>{counts.closed}</strong></article>
          </div>
        )}
        <section id="publish-role" className="card card-pad employer-job-section employer-publish-section" aria-labelledby="publish-role-heading">
          <div className="employer-section-heading">
            <div><span className="section-kicker">CREATE A LISTING</span><h2 id="publish-role-heading">Publish a role</h2><p>Share the role details candidates need to decide whether it is right for them.</p></div>
            <span className="employer-section-mark" aria-hidden="true">+</span>
          </div>
          <EmployerJobForm />
        </section>
        <section className="card card-pad employer-job-section employer-roles-section" aria-labelledby="your-roles-heading">
          <div className="employer-section-heading">
            <div><span className="section-kicker">ROLE MANAGEMENT</span><h2 id="your-roles-heading">Your roles</h2><p>Review the status of your recent listings and open a role to see its public page.</p></div>
            {counts && <span className="employer-section-count">{counts.total} {counts.total === 1 ? "role" : "roles"}</span>}
          </div>
          {error ? <p className="account-form-error" role="alert">{error}</p> : jobs.length ? (
            <div className="account-job-list">
              {jobs.map((job) => {
                const createdAt = job.createdAt instanceof Date ? job.createdAt : new Date(job.createdAt);
                const postedDate = Number.isNaN(createdAt.getTime()) ? null : createdAt;
                return (
                  <article className="account-job-item employer-role-item" key={job.slug}>
                    <div className="employer-role-copy">
                      <Link href={`/jobs/${encodeURIComponent(job.slug)}`}>{job.title}</Link>
                      <span>{job.location} · {job.employmentType.replace("_", "-")} · {job.workplaceType}{postedDate && <> · Posted <time dateTime={postedDate.toISOString()}>{formatPostedDate(postedDate)}</time></>}</span>
                    </div>
                    <div className="employer-role-actions">
                      <span className={`employer-job-status ${job.status === "published" ? "is-live" : job.status === "draft" ? "is-draft" : "is-closed"}`}>{job.status}</span>
                      <Link className="btn btn-line" href={`/jobs/${encodeURIComponent(job.slug)}`}>View role <span aria-hidden="true">→</span></Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <div className="employer-empty-roles"><span aria-hidden="true">+</span><div><strong>No roles yet</strong><p>Your published and draft listings will appear here.</p></div><Link href="#publish-role">Create your first role <span aria-hidden="true">→</span></Link></div>}
        </section>
        <EmployerCompanyProfile />
      </div>
    </main>
  );
}
