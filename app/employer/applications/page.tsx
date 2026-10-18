import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { RowDataPacket } from "mysql2";
import EmployerApplicationStatus from "@/components/EmployerApplicationStatus";
import EmployerAiScreening from "@/components/EmployerAiScreening";
import { getCurrentAccount } from "@/lib/auth";
import { LOCAL_AI_SCREENING_CONSENT_VERSION } from "@/lib/ai-consent";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable } from "@/lib/http";

export const metadata: Metadata = { title: "Employer applications" };
export const dynamic = "force-dynamic";

type ApplicantRow = RowDataPacket & {
  id: string;
  jobSlug: string;
  jobTitle: string;
  fullName: string;
  email: string;
  status: "applied" | "screening" | "interview" | "offer" | "rejected" | "withdrawn";
  createdAt: Date | string;
  resumeName: string | null;
  screeningConsent: number;
  screeningConsentVersion: string | null;
  screeningResult: unknown;
};

const applicationStatuses = ["applied", "screening", "interview", "offer", "rejected", "withdrawn"] as const;

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function formatApplicationDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

export default async function EmployerApplicationsPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  if (account.role !== "recruiter" || !account.recruiterVerified) {
    return (
      <main className="jobs-page"><div className="wrap account-page"><section className="card card-pad">
        <h1>Verified recruiter access required</h1><p>Only approved recruiters can view applications for their roles.</p>
      </section></div></main>
    );
  }

  let applicants: ApplicantRow[] = [];
  let error = "";
  try {
    const [rows] = await getDatabase().execute<ApplicantRow[]>(
      `SELECT CAST(a.id AS CHAR) AS id, j.slug AS jobSlug, j.title AS jobTitle,
              u.full_name AS fullName, u.email, a.status, a.created_at AS createdAt,
              resume.original_name AS resumeName,
              a.ai_screening_consent AS screeningConsent,
              a.ai_screening_consent_version AS screeningConsentVersion,
              screening.result_json AS screeningResult
       FROM applications a
       INNER JOIN jobs j ON j.id = a.job_id
       INNER JOIN users u ON u.id = a.user_id
       LEFT JOIN application_resumes resume ON resume.application_id = a.id
       LEFT JOIN ai_application_screenings screening ON screening.application_id = a.id
       WHERE j.employer_id = ? AND j.source_id IS NULL
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [account.id],
    );
    applicants = rows;
  } catch (caught) {
    if (isDatabaseUnavailable(caught)) {
      error = "Applications are unavailable. Check that MySQL is running and database/schema.sql has been applied.";
    } else {
      console.error("Unable to load employer applications.", caught);
      error = "We couldn't load your applications.";
    }
  }

  return (
    <main className="jobs-page">
      <div className="wrap account-page">
        <div className="crumbs"><Link href="/employer/jobs">Employer workspace</Link><span aria-hidden="true">/</span><b>Applications</b></div>
        <div className="employer-applications-page">
          <header className="account-dashboard-hero employer-applications-hero">
            <div className="account-dashboard-hero-copy">
              <span className="account-dashboard-kicker">YOUR HIRING PIPELINE</span>
              <h1>Applications</h1>
              <p>Review candidate details, open resumes, and move each application through your hiring process.</p>
            </div>
            <div className="account-dashboard-hero-side">
              <span className="account-role-badge"><span aria-hidden="true">●</span> Verified employer</span>
              <Link className="btn btn-line" href="/employer/jobs">Manage roles <span aria-hidden="true">→</span></Link>
            </div>
          </header>
          {error ? <section className="card card-pad employer-applications-panel"><p className="account-form-error" role="alert">{error}</p></section> : (
            <>
              <div className="employer-applications-stats" aria-label="Application overview">
                <article><span>Recent applications</span><strong>{applicants.length}</strong></article>
                <article><span>In review</span><strong>{applicants.filter((item) => item.status === "applied" || item.status === "screening").length}</strong></article>
                <article><span>Interviews</span><strong>{applicants.filter((item) => item.status === "interview").length}</strong></article>
                <article><span>Offers</span><strong>{applicants.filter((item) => item.status === "offer").length}</strong></article>
              </div>
              <section className="card card-pad employer-applications-panel" aria-labelledby="application-list-heading">
                <div className="employer-section-heading">
                  <div>
                    <span className="section-kicker">CANDIDATE ACTIVITY</span>
                    <h2 id="application-list-heading">Recent applications</h2>
                    <p>Status totals reflect the latest {applicants.length} applications, newest first.</p>
                  </div>
                  <span className="employer-section-count">{applicants.length} {applicants.length === 1 ? "applicant" : "applicants"}</span>
                </div>
                <p className="employer-screening-disclosure"><span aria-hidden="true">i</span> Optional AI screening is advisory only and available only when a candidate has consented. Review resumes and make hiring decisions yourself; never rely on an AI score alone.</p>
                {applicants.length ? (
                  <div className="employer-applicant-list">
              {applicants.map((applicant) => (
                (() => {
                  let screeningResult: {
                    score: number;
                    strengths: string[];
                    gaps: string[];
                    evidence: string[];
                    questions: string[];
                    caveat: string;
                  } | null = null;
                  try {
                    const value = typeof applicant.screeningResult === "string"
                      ? JSON.parse(applicant.screeningResult)
                      : applicant.screeningResult;
                    if (value && typeof value === "object" && "score" in value && typeof value.score === "number") {
                      screeningResult = value as typeof screeningResult;
                    }
                  } catch (caught) {
                    console.error("Stored AI screening result could not be parsed.", caught);
                  }
                  const submittedAt = applicant.createdAt instanceof Date
                    ? applicant.createdAt
                    : new Date(applicant.createdAt);
                  const submittedDateTime = Number.isNaN(submittedAt.getTime())
                    ? undefined
                    : submittedAt.toISOString();
                  const status = applicationStatuses.includes(applicant.status) ? applicant.status : "applied";
                  return <article className="employer-applicant-item employer-applicant-item-expanded employer-applicant-card" key={applicant.id}>
                    <div className="employer-applicant-main">
                      <div className="employer-applicant-identity">
                        <span className="employer-applicant-avatar" aria-hidden="true">{initials(applicant.fullName)}</span>
                        <div className="employer-applicant-person">
                          <strong>{applicant.fullName}</strong>
                          <a href={`mailto:${encodeURIComponent(applicant.email)}`}>{applicant.email}</a>
                        </div>
                        <span className={`employer-job-status is-${status}`}>{status}</span>
                      </div>
                      <div className="employer-applicant-role">
                        <span className="employer-applicant-meta-label">Applied for</span>
                        <Link href={`/jobs/${encodeURIComponent(applicant.jobSlug)}`}>{applicant.jobTitle}<span aria-hidden="true"> ↗</span></Link>
                        <span className="employer-applicant-date"><time dateTime={submittedDateTime}>{formatApplicationDate(applicant.createdAt)}</time></span>
                      </div>
                      <div className="employer-applicant-resume">
                        <span className="employer-applicant-resume-icon" aria-hidden="true">↧</span>
                        {applicant.resumeName
                          ? <a href={`/api/employer/applications/${encodeURIComponent(applicant.id)}/resume`}><span><strong>Resume</strong><small>{applicant.resumeName}</small></span><span aria-hidden="true">↓</span></a>
                          : <span className="employer-applicant-no-resume">No resume attached</span>}
                      </div>
                      <EmployerAiScreening
                        applicationId={applicant.id}
                        consented={
                          Boolean(applicant.screeningConsent) &&
                          applicant.screeningConsentVersion === LOCAL_AI_SCREENING_CONSENT_VERSION
                        }
                        hasResume={Boolean(applicant.resumeName)}
                        initialResult={screeningResult}
                      />
                    </div>
                    <div className="employer-applicant-card-actions">
                      <EmployerApplicationStatus id={applicant.id} initialStatus={applicant.status} />
                    </div>
                  </article>;
                })()
              ))}
                  </div>
                ) : (
                  <div className="employer-applications-empty">
                    <span aria-hidden="true">✳</span>
                    <h3>No applications yet</h3>
                    <p>Applications to your live roles will appear here as candidates apply.</p>
                    <Link className="btn btn-line" href="/employer/jobs">View your roles <span aria-hidden="true">→</span></Link>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
