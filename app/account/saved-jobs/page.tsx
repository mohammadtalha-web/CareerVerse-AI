import Link from "next/link";
import { redirect } from "next/navigation";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable } from "@/lib/http";

export const dynamic = "force-dynamic";

type SavedJobRow = RowDataPacket & {
  slug: string;
  title: string;
  companyName: string;
  location: string;
  createdAt: Date | string;
};

export default async function SavedJobsPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");

  let jobs: SavedJobRow[] = [];
  let error = "";
  try {
    const [rows] = await getDatabase().execute<SavedJobRow[]>(
      `SELECT j.slug, j.title, j.company_name AS companyName, j.location,
              s.created_at AS createdAt
       FROM saved_jobs s
       INNER JOIN jobs j ON j.id = s.job_id
       WHERE s.user_id = ?
         AND j.status = 'published'
         AND (j.expires_at IS NULL OR j.expires_at > CURRENT_TIMESTAMP)
       ORDER BY s.created_at DESC
       LIMIT 100`,
      [account.id],
    );
    jobs = rows;
  } catch (caught) {
    if (isDatabaseUnavailable(caught)) {
      error = "Your saved jobs are unavailable. Check that the database schema is installed.";
    } else {
      console.error("Unable to load saved jobs.", caught);
      error = "We couldn't load your saved jobs.";
    }
  }

  return (
    <main className="jobs-page">
      <div className="wrap account-page">
        <div className="crumbs"><Link href="/account">Your account</Link><span aria-hidden="true">/</span><b>Saved jobs</b></div>
        <section className="card card-pad">
          <span className="section-kicker">YOUR SHORTLIST</span>
          <h1>Saved jobs</h1>
          {error ? <p role="alert" className="account-form-error">{error}</p> : jobs.length ? (
            <div className="account-job-list">
              {jobs.map((job) => (
                <article key={job.slug} className="account-job-item">
                  <div><Link href={`/jobs/${job.slug}`}>{job.title}</Link><span>{job.companyName} · {job.location}</span></div>
                  <Link href={`/jobs/${job.slug}`} className="btn btn-line">View role</Link>
                </article>
              ))}
            </div>
          ) : <p>Your saved opportunities will appear here.</p>}
          <Link className="btn btn-violet" href="/jobs">Browse jobs</Link>
        </section>
      </div>
    </main>
  );
}
