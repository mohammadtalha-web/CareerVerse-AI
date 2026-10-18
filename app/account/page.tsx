import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable } from "@/lib/http";
import { searchJobs, type JobSearchPage } from "@/lib/job-repository";

export const metadata: Metadata = { title: "Your account" };

export const dynamic = "force-dynamic";

type SeekerSummaryRow = RowDataPacket & {
  applications: number | string;
  savedJobs: number | string;
  profileVisibility: "private" | "public" | null;
};

type RecruiterSummaryRow = RowDataPacket & {
  totalRoles: number | string;
  publishedRoles: number | string;
  applications: number | string;
  applicationsToReview: number | string;
};

type AccountLink = {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  icon: string;
};

export default async function AccountPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");

  const displayName = account.fullName.trim() || "there";
  const roleName = account.role === "admin"
    ? "Administrator"
    : account.role === "recruiter"
      ? "Employer account"
      : "Job seeker";
  let summaryError = "";
  let applications = 0;
  let savedJobs = 0;
  let profileVisibility: "private" | "public" | null = null;
  let totalRoles = 0;
  let publishedRoles = 0;
  let applicationsToReview = 0;
  let recruiterApplications = 0;
  let featuredJobs: JobSearchPage["jobs"] = [];
  let jobsError = "";

  try {
    if (account.role === "job_seeker") {
      const [rows] = await getDatabase().execute<SeekerSummaryRow[]>(
        `SELECT
           (SELECT COUNT(*) FROM applications WHERE user_id = ?) AS applications,
           (SELECT COUNT(*) FROM saved_jobs WHERE user_id = ?) AS savedJobs,
           (SELECT visibility FROM networking_profiles WHERE user_id = ? LIMIT 1) AS profileVisibility`,
        [account.id, account.id, account.id],
      );
      applications = Number(rows[0]?.applications ?? 0);
      savedJobs = Number(rows[0]?.savedJobs ?? 0);
      profileVisibility = rows[0]?.profileVisibility ?? null;
    } else if (account.role === "recruiter") {
      const [rows] = await getDatabase().execute<RecruiterSummaryRow[]>(
        `SELECT COUNT(*) AS totalRoles,
                COALESCE(SUM(status = 'published' AND moderation_hidden = FALSE), 0) AS publishedRoles,
                (SELECT COUNT(*)
                 FROM applications a
                 INNER JOIN jobs application_job ON application_job.id = a.job_id
                 WHERE application_job.employer_id = ?
                   AND application_job.source_id IS NULL
                   AND a.status != 'withdrawn') AS applications,
                (SELECT COUNT(*)
                 FROM applications a
                 INNER JOIN jobs application_job ON application_job.id = a.job_id
                 WHERE application_job.employer_id = ?
                   AND application_job.source_id IS NULL
                   AND a.status = 'applied') AS applicationsToReview
         FROM jobs WHERE employer_id = ? AND source_id IS NULL AND is_sample = FALSE`,
        [account.id, account.id, account.id],
      );
      totalRoles = Number(rows[0]?.totalRoles ?? 0);
      publishedRoles = Number(rows[0]?.publishedRoles ?? 0);
      recruiterApplications = Number(rows[0]?.applications ?? 0);
      applicationsToReview = Number(rows[0]?.applicationsToReview ?? 0);
    }
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      summaryError = "Some account activity is unavailable right now. Your core account controls are still available.";
    } else {
      console.error("Unable to load the account summary.", error);
      summaryError = "We couldn't load your latest account activity.";
    }
  }

  if (account.role === "job_seeker") {
    try {
      const result = await searchJobs({ pageSize: 3 });
      featuredJobs = result.jobs;
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        jobsError = "Job recommendations are temporarily unavailable. You can still search the full job catalog.";
      } else {
        console.error("Loading account job recommendations failed.", error);
        jobsError = "We couldn't load job recommendations. Please try the full job search.";
      }
    }
  }

  const workspaceLinks: AccountLink[] = account.role === "job_seeker"
    ? [
        { href: "/account/applications", eyebrow: "APPLICATION TRACKING", title: "My applications", description: "Review the roles you have applied to and check their current status.", action: "View applications", icon: "↗" },
        { href: "/account/saved-jobs", eyebrow: "YOUR SHORTLIST", title: "Saved jobs", description: "Keep promising opportunities together while you decide what is next.", action: "Open saved jobs", icon: "☆" },
        { href: "/networking/profile", eyebrow: "PROFESSIONAL BRAND", title: "Profile & portfolio", description: "Present your experience, skills, and selected work to your network.", action: "Edit profile", icon: "◎" },
        { href: "/networking/connections", eyebrow: "PROFESSIONAL NETWORK", title: "Connections", description: "Build relationships with other professionals on CareerVerse.", action: "Manage connections", icon: "♙" },
        { href: "/networking/messages", eyebrow: "CONVERSATIONS", title: "Messages", description: "Continue conversations with your accepted connections.", action: "Open messages", icon: "✉" },
        { href: "/networking/feed", eyebrow: "COMMUNITY", title: "Career feed", description: "Share professional updates and learn from the community.", action: "Visit the feed", icon: "⌂" },
      ]
    : account.role === "recruiter"
      ? account.recruiterVerified
        ? [
          { href: "/employer/jobs", eyebrow: "EMPLOYER WORKSPACE", title: "Job listings", description: "Create, publish, and manage your open roles.", action: "Open employer workspace", icon: "▤" },
          { href: "/employer/applications", eyebrow: "CANDIDATE PIPELINE", title: "Applications", description: "Review candidate applications for roles you have published.", action: "Review applications", icon: "♙" },
          { href: "/companies", eyebrow: "COMPANY DIRECTORY", title: "Explore companies", description: "Browse verified employer profiles and discover the wider network.", action: "Browse companies", icon: "⌕" },
        ]
        : [
            { href: "/employer/jobs", eyebrow: "EMPLOYER WORKSPACE", title: "Verification status", description: "Check your employer workspace and review the publishing approval requirement.", action: "View verification status", icon: "✓" },
            { href: "/jobs", eyebrow: "JOB MARKETPLACE", title: "Explore opportunities", description: "Browse available roles while your employer account is being reviewed.", action: "Browse jobs", icon: "⌕" },
            { href: "/companies", eyebrow: "COMPANY DIRECTORY", title: "Explore companies", description: "Discover organizations and browse their published company profiles.", action: "Browse companies", icon: "▦" },
          ]
      : [
          { href: "/admin", eyebrow: "PLATFORM OPERATIONS", title: "Admin workspace", description: "Review members, employer access, content reports, and audit history.", action: "Open admin console", icon: "▦" },
          { href: "/jobs", eyebrow: "MARKETPLACE", title: "Job marketplace", description: "Browse opportunities available across the CareerVerse catalog.", action: "Explore opportunities", icon: "⌕" },
        ];

  return (
    <main className="jobs-page account-dashboard-page">
      <div className="wrap account-page account-dashboard">
        <div className="crumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><b>Account</b></div>
        <section className="account-dashboard-hero">
          <div className="account-dashboard-hero-copy">
            <span className="account-dashboard-kicker">YOUR CAREERVERSE</span>
            <h1>Welcome back, {displayName}.</h1>
            <p>{account.role === "recruiter"
              ? "Your hiring pipeline, job listings, and recruiting activity—together in one place."
              : account.role === "admin"
                ? "Your platform workspace, review tools, and account activity—together in one place."
                : "Your job search, saved opportunities, and career next steps—together in one place."}</p>
            <div className="account-dashboard-identity">
              <span className="account-dashboard-avatar" aria-hidden="true">{account.fullName.trim().charAt(0).toUpperCase()}</span>
              <span><strong>{account.fullName}</strong><small>{account.email}</small></span>
            </div>
          </div>
          <div className="account-dashboard-hero-side">
            <span className={`account-role-badge ${account.role === "recruiter" && !account.recruiterVerified ? "account-role-pending" : ""}`}>
              <span aria-hidden="true">●</span>{roleName}{account.role === "recruiter" ? account.recruiterVerified ? " · Verified" : " · Verification pending" : ""}
            </span>
          </div>
        </section>

        {summaryError && <p className="account-dashboard-notice" role="status">{summaryError}</p>}
        {account.role === "recruiter" && !account.recruiterVerified && (
          <section className="account-verification-callout">
            <span className="account-verification-icon" aria-hidden="true">!</span>
            <div><strong>Employer verification is in progress</strong><p>A CareerVerse administrator must verify your organization before you can publish roles. You can still prepare your employer workspace in the meantime.</p></div>
            <Link href="/employer/jobs">View status <span aria-hidden="true">→</span></Link>
          </section>
        )}

        {account.role === "job_seeker" ? (
          <section className="account-overview-grid" aria-label="Your career overview">
            <Link className="account-overview-card" href="/account/applications"><span className="account-overview-icon overview-violet">↗</span><span className="account-overview-label">Applications</span><strong>{summaryError ? "—" : applications}</strong><small>Roles you have applied to</small></Link>
            <Link className="account-overview-card" href="/account/saved-jobs"><span className="account-overview-icon overview-blue">☆</span><span className="account-overview-label">Saved jobs</span><strong>{summaryError ? "—" : savedJobs}</strong><small>Opportunities in your shortlist</small></Link>
            <Link className="account-overview-card" href="/networking/profile"><span className="account-overview-icon overview-green">◎</span><span className="account-overview-label">Profile visibility</span><strong className="account-profile-state">{profileVisibility === "public" ? "Public" : profileVisibility === "private" ? "Private" : "Not set up"}</strong><small>{profileVisibility === "public" ? "Visible to visitors" : "Choose when to publish"}</small></Link>
          </section>
        ) : account.role === "recruiter" ? (
          <section className="account-overview-grid account-recruiter-overview" aria-label="Your employer overview">
            <Link className="account-overview-card" href="/employer/jobs"><span className="account-overview-icon overview-violet">▤</span><span className="account-overview-label">Employer roles</span><strong>{summaryError ? "—" : totalRoles}</strong><small>Roles in your workspace</small></Link>
            <Link className="account-overview-card" href="/employer/jobs"><span className="account-overview-icon overview-green">●</span><span className="account-overview-label">Published roles</span><strong>{summaryError ? "—" : publishedRoles}</strong><small>Currently visible in the marketplace</small></Link>
            <Link className="account-overview-card" href="/employer/applications"><span className="account-overview-icon overview-blue">♙</span><span className="account-overview-label">Applications</span><strong>{summaryError ? "—" : recruiterApplications}</strong><small>For your employer roles</small></Link>
            <Link className="account-overview-card" href="/employer/applications"><span className="account-overview-icon overview-amber">!</span><span className="account-overview-label">New to review</span><strong>{summaryError ? "—" : applicationsToReview}</strong><small>Applications awaiting first review</small></Link>
          </section>
        ) : null}

        {account.role === "job_seeker" && (
          <section className="account-live-section" aria-labelledby="account-jobs-title">
            <div className="account-section-heading">
              <div><span className="account-dashboard-kicker">FRESH OPPORTUNITIES</span><h2 id="account-jobs-title">A few roles to explore</h2><p>Current listings from the CareerVerse job catalog.</p></div>
              <Link href="/jobs">Search all jobs <span aria-hidden="true">→</span></Link>
            </div>
            {jobsError ? <p className="account-dashboard-notice" role="status">{jobsError}</p> : featuredJobs.length > 0 ? (
              <div className="account-featured-jobs">
                {featuredJobs.map((job) => (
                  <Link className="account-featured-job" href={`/jobs/${encodeURIComponent(job.slug)}`} key={job.slug}>
                    <span className="account-featured-job-mark" aria-hidden="true">{job.initials}</span>
                    <span className="account-featured-job-info">
                      <strong>{job.title}</strong>
                      <small>{job.company} · {job.location} · {job.type}</small>
                      <span className={`account-featured-job-source${job.isSample ? " is-sample" : ""}`}>
                        {job.isSample ? "Sample listing · not a live vacancy" : `${job.sourceName} · ${job.posted}`}
                      </span>
                    </span>
                    <span className="account-featured-job-arrow" aria-hidden="true">↗</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="account-live-empty">
                <strong>No current listings to feature</strong>
                <p>Check the full job catalog for new opportunities, or revisit your saved jobs.</p>
                <Link href="/jobs">Browse jobs <span aria-hidden="true">→</span></Link>
              </div>
            )}
          </section>
        )}

        {account.role === "recruiter" && (
          <section className="account-hiring-focus" aria-labelledby="account-hiring-focus-title">
            <div className="account-hiring-focus-copy">
              <span className="account-dashboard-kicker">HIRING ACTIVITY</span>
              <h2 id="account-hiring-focus-title">
                {summaryError
                  ? "Your applicant activity is temporarily unavailable"
                  : applicationsToReview > 0
                    ? `${applicationsToReview} new ${applicationsToReview === 1 ? "application" : "applications"} to review`
                    : publishedRoles > 0
                      ? "Your published roles are live"
                      : "Get your next role ready to publish"}
              </h2>
              <p>
                {summaryError
                  ? "Try the applications workspace again to see the latest candidate activity."
                  : applicationsToReview > 0
                    ? "Open your hiring pipeline to review candidates and update their application status."
                    : publishedRoles > 0
                      ? "No new applications are waiting right now. You can check your pipeline or manage your listings."
                      : account.recruiterVerified
                        ? "Create a listing to reach job seekers on CareerVerse."
                        : "Your recruiter account needs verification before you can publish job listings."}
              </p>
            </div>
            <div className="account-hiring-focus-actions">
              {account.recruiterVerified && (
                <Link className="btn btn-violet" href="/employer/applications">
                  {applicationsToReview > 0 ? "Review applications" : "Open hiring pipeline"} <span aria-hidden="true">→</span>
                </Link>
              )}
              <Link className="btn btn-line" href="/employer/jobs">
                {account.recruiterVerified ? "Manage job listings" : "Open employer workspace"} <span aria-hidden="true">→</span>
              </Link>
            </div>
          </section>
        )}

        <section className="account-workspace-section">
          <div className="account-section-heading"><div><span className="account-dashboard-kicker">YOUR WORKSPACE</span><h2>{account.role === "admin" ? "Platform controls" : account.role === "recruiter" ? "Employer tools" : "Pick up where you left off"}</h2><p>{account.role === "admin" ? "Secure shortcuts to the areas you manage." : "Useful tools and activity, organized around your goals."}</p></div>{account.role !== "admin" && <Link href="/jobs">Browse jobs <span aria-hidden="true">→</span></Link>}</div>
          <div className="account-workspace-grid">
            {workspaceLinks.map((item) => <Link className="account-workspace-card" href={item.href} key={item.href}>
              <span className="account-workspace-icon" aria-hidden="true">{item.icon}</span>
              <span className="account-workspace-eyebrow">{item.eyebrow}</span>
              <strong>{item.title}</strong>
              <p>{item.description}</p>
              <span className="account-workspace-action">{item.action} <span aria-hidden="true">→</span></span>
            </Link>)}
          </div>
        </section>
      </div>
    </main>
  );
}