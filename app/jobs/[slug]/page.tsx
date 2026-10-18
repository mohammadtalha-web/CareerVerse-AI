import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { RowDataPacket } from "mysql2";
import JobActions from "@/components/JobActions";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { careerJobs, getCareerJob } from "@/lib/jobs";
import { getLiveJobBySlug } from "@/lib/job-repository";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return careerJobs.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const job = getCareerJob(slug) ?? await getLiveJobBySlug(slug);
  return job ? { title: `${job.title} at ${job.company}` } : { title: "Job not found" };
}

export default async function JobDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = getCareerJob(slug) ?? await getLiveJobBySlug(slug);
  if (!job) notFound();

  let alreadyApplied = false;
  let applicationStatusUnavailable = false;
  let isAuthenticated = false;
  try {
    const account = await getCurrentAccount();
    isAuthenticated = account !== null;
    if (account?.role === "job_seeker" && job.id && !job.isSample && !job.external) {
      const [rows] = await getDatabase().execute<(RowDataPacket & { id: number })[]>(
        "SELECT id FROM applications WHERE user_id = ? AND job_id = ? LIMIT 1",
        [account.id, job.id],
      );
      alreadyApplied = rows.length > 0;
    }
  } catch (error) {
    console.error("Unable to check whether the current member applied to this job.", error);
    applicationStatusUnavailable = true;
  }

  return (
    <main className="jobs-page">
      <div className="wrap">
        <div className="crumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href="/jobs">Find jobs</Link><span aria-hidden="true">/</span><b>{job.title}</b></div>
        <div className="job-detail-layout">
          <article className="job-detail-card">
            <div className="detail-company-heading">
              <div className="result-company-logo">{job.initials}</div>
              <div><span className="result-company-name">{job.company} · {job.sourceName}</span><h1>{job.title}</h1><p>{job.location}<i />{job.type}<i />{job.experience}<i />{job.countryCode}</p></div>
            </div>
            {job.match !== null && <div className="detail-match"><span>✳</span><div><strong>{job.match}% AI match</strong><small>AI-generated estimate based on profile and role information.</small></div></div>}
            {job.sourceUrl && <p className="job-source-link">Source: <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">{job.sourceName} ↗</a></p>}
            <section className="detail-section"><h2>About the role</h2><p>{job.description}</p></section>
            <section className="detail-section"><h2>What you’ll bring</h2><ul>{job.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul></section>
            <section className="detail-section"><h2>Role details</h2><div className="detail-facts"><div><span>Work style</span><strong>{job.type}</strong></div><div><span>Experience</span><strong>{job.experience}</strong></div><div><span>Compensation</span><strong>{job.salary}</strong></div><div><span>Posted</span><strong>{job.posted}</strong></div></div></section>
          </article>
          <aside className="job-detail-aside">
            <div className="card card-pad">
              <span className="section-kicker">READY FOR YOUR NEXT MOVE?</span>
              <h2>Make your profile work for you.</h2>
              <p>Review the listing source and choose how you’d like to apply.</p>
              <JobActions key={job.slug} slug={job.slug} jobId={job.id} isSample={job.isSample} external={job.external} sourceName={job.sourceName} applyUrl={job.applyUrl} isAuthenticated={isAuthenticated} alreadyApplied={alreadyApplied} applicationStatusUnavailable={applicationStatusUnavailable} />
              <Link href="/resume-builder" className="btn btn-line detail-primary-action">Build your resume <span aria-hidden="true">→</span></Link>
              <Link href="/jobs" className="detail-back-link">Back to all opportunities</Link>
            </div>
            <div className="card card-pad detail-note"><strong>A note about this listing</strong><p>{job.isSample ? "This is a clearly labelled example, not a live vacancy. Application and saved-job actions are disabled." : "Check the employer or source portal for the latest status and application requirements."}</p></div>
          </aside>
        </div>
      </div>
    </main>
  );
}
