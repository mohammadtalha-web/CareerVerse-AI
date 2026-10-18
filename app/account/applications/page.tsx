import Link from "next/link";
import { redirect } from "next/navigation";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable } from "@/lib/http";

export const dynamic = "force-dynamic";

type ApplicationRow = RowDataPacket & {
  slug: string;
  title: string;
  companyName: string;
  location: string;
  status: string;
  createdAt: Date | string;
};

export default async function ApplicationsPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");

  let applications: ApplicationRow[] = [];
  let error = "";
  try {
    const [rows] = await getDatabase().execute<ApplicationRow[]>(
      `SELECT j.slug, j.title, j.company_name AS companyName, j.location,
              a.status, a.created_at AS createdAt
       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [account.id],
    );
    applications = rows;
  } catch (caught) {
    if (isDatabaseUnavailable(caught)) {
      error = "Your application history is unavailable. Check that the database schema is installed.";
    } else {
      console.error("Unable to load account applications.", caught);
      error = "We couldn't load your applications.";
    }
  }

  return (
    <main className="jobs-page">
      <div className="wrap account-page">
        <div className="crumbs"><Link href="/account">Your account</Link><span aria-hidden="true">/</span><b>Applications</b></div>
        <section className="card card-pad">
          <span className="section-kicker">YOUR JOB SEARCH</span>
          <h1>My applications</h1>
          {error ? <p role="alert" className="account-form-error">{error}</p> : applications.length ? (
            <div className="account-job-list">
              {applications.map((application) => (
                <article key={`${application.slug}-${application.createdAt}`} className="account-job-item">
                  <div><Link href={`/jobs/${application.slug}`}>{application.title}</Link><span>{application.companyName} · {application.location}</span></div>
                  <span className="result-tag">{application.status}</span>
                </article>
              ))}
            </div>
          ) : <p>You haven’t applied to any CareerVerse roles yet. Sample listings cannot accept applications.</p>}
          <Link className="btn btn-violet" href="/jobs">Find opportunities</Link>
        </section>
      </div>
    </main>
  );
}
