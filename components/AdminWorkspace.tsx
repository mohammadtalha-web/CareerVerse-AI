"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  AdminJob,
  AdminOverview,
  AdminRecentUser,
  AdminUserPage,
  AdminUserRole,
} from "@/lib/admin";

type Props = {
  administratorName: string;
  initialOverview: AdminOverview | null;
  initialMembers: AdminUserPage | null;
  loadError: string;
};

type ContentReport = {
  id: string;
  targetId: string;
  targetType: "post" | "profile" | "job";
  category: string;
  details: string | null;
  status: "pending" | "actioned" | "dismissed";
  createdAt: string;
  reporterName: string;
  targetLabel: string;
  targetOwner: string | null;
  targetHidden: number | boolean | null;
  targetSlug: string | null;
};

type AuditEntry = {
  id: string;
  action: string;
  reason: string | null;
  targetJobId: string | null;
  targetPostId: string | null;
  targetProfileUserId: string | null;
  targetHidden: number | boolean | null;
  createdAt: string;
  actorName: string;
  targetUserName: string | null;
  targetJobTitle: string | null;
  targetPostBody: string | null;
  targetProfileName: string | null;
};

type AuditFilter = "all" | "reports" | "recruiters" | "jobs" | "content";
type ReasonAction =
  | { type: "recruiter"; id: string; verified: boolean }
  | { type: "job-status"; id: string; status: "draft" | "published" | "closed" }
  | { type: "job-visibility"; job: AdminJob }
  | { type: "restore-audit"; entry: AuditEntry };

const numberFormat = new Intl.NumberFormat("en");
const roles: { value: AdminUserRole; label: string }[] = [
  { value: "all", label: "All accounts" },
  { value: "job_seeker", label: "Job seekers" },
  { value: "recruiter", label: "Recruiters" },
  { value: "admin", label: "Administrators" },
];

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

async function errorFromResponse(response: Response, fallback: string): Promise<string> {
  const result: unknown = await response.json().catch(() => null);
  return typeof result === "object" && result !== null && "error" in result &&
    typeof result.error === "string"
    ? result.error
    : fallback;
}

function roleLabel(role: AdminRecentUser["role"]): string {
  if (role === "job_seeker") return "Job seeker";
  if (role === "recruiter") return "Recruiter";
  return "Administrator";
}

export default function AdminWorkspace({ administratorName, initialOverview, initialMembers, loadError }: Props) {
  const [overview, setOverview] = useState(initialOverview);
  const [error, setError] = useState(loadError);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberRole, setMemberRole] = useState<AdminUserRole>("all");
  const [members, setMembers] = useState<AdminUserPage>(initialMembers ?? {
    users: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
  const [memberError, setMemberError] = useState("");
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [reportError, setReportError] = useState("");
  const [reportReasons, setReportReasons] = useState<Record<string, string>>({});
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [reportPage, setReportPage] = useState(1);
  const [reportTotal, setReportTotal] = useState(0);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");

  const loadSafetyData = useCallback(async (page: number) => {
    setReportError("");
    try {
      const reportResponse = await fetch(`/api/admin/reports?status=pending&page=${page}`, { cache: "no-store" });
      if (!reportResponse.ok) throw new Error(await errorFromResponse(reportResponse, "Couldn't load the report queue."));
      const reportData = await reportResponse.json() as { reports: ContentReport[]; page: number; total: number };
      setReports(reportData.reports);
      setReportPage(reportData.page);
      setReportTotal(reportData.total);
    } catch (caught) {
      setReportError(caught instanceof Error ? caught.message : "Couldn't load the report queue.");
    }
  }, []);

  const loadAudit = useCallback(async (page: number, filter: AuditFilter) => {
    setAuditError("");
    try {
      const parameters = new URLSearchParams({ page: String(page), filter });
      const response = await fetch(`/api/admin/audit?${parameters}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await errorFromResponse(response, "Couldn't load moderation history."));
      const result = await response.json() as { entries: AuditEntry[]; page: number; total: number };
      setAuditEntries(result.entries);
      setAuditPage(result.page);
      setAuditTotal(result.total);
    } catch (caught) {
      setAuditError(caught instanceof Error ? caught.message : "Couldn't load moderation history.");
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(() => Promise.all([loadSafetyData(1), loadAudit(1, "all")])); }, [loadSafetyData, loadAudit]);

  const loadMembers = useCallback(async (query: string, role: AdminUserRole, page: number) => {
    setMemberError("");
    try {
      const parameters = new URLSearchParams({ q: query, role, page: String(page) });
      const response = await fetch(`/api/admin/users?${parameters}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await errorFromResponse(response, "Couldn't load accounts."));
      setMembers((await response.json()) as AdminUserPage);
    } catch (caught) {
      setMemberError(caught instanceof Error ? caught.message : "Couldn't load accounts.");
    }
  }, []);

  async function refreshOverview(): Promise<boolean> {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!response.ok) throw new Error(await errorFromResponse(response, "Couldn't refresh the workspace."));
      setOverview((await response.json()) as AdminOverview);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't refresh the workspace.");
      return false;
    } finally {
      setRefreshing(false);
    }
  }

  async function reviewRecruiter(id: string, verified: boolean, reason: string) {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/recruiters/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verified, reason }),
      });
      if (!response.ok) throw new Error(await errorFromResponse(response, "The review decision could not be saved."));
      const refreshed = await refreshOverview();
      await loadMembers(memberQuery, memberRole, members.page);
      if (refreshed) setNotice(verified ? "Employer verified successfully." : "Employer publishing access revoked.");
      setReasonAction(null);
      setDecisionReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review decision could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  async function moderateJob(id: string, status: "draft" | "published" | "closed", reason: string) {
    setBusyJobId(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/jobs/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason }),
      });
      if (!response.ok) throw new Error(await errorFromResponse(response, "The job status could not be saved."));
      setReasonAction(null);
      setDecisionReason("");
      if (await refreshOverview()) setNotice(`Job status changed to ${status}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The job status could not be saved.");
    } finally {
      setBusyJobId(null);
    }
  }

  async function toggleJobVisibility(job: AdminOverview["jobs"][number], reason: string) {
    const decision = job.moderationHidden ? "restore" : "hide";
    setBusyJobId(job.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/moderation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "job", targetId: job.id, decision, reason }),
      });
      if (!response.ok) throw new Error(await errorFromResponse(response, "The listing visibility change could not be saved."));
      setReasonAction(null);
      setDecisionReason("");
      await refreshOverview();
      await loadSafetyData(reportPage);
      await loadAudit(auditPage, auditFilter);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The listing visibility change could not be saved.");
    } finally {
      setBusyJobId(null);
    }
  }

  async function reviewReport(report: ContentReport, decision: "hide" | "restore" | "dismiss") {
    const reason = reportReasons[report.id]?.trim() ?? "";
    if (reason.length < 3) {
      setReportError("Enter a moderation reason of at least 3 characters before reviewing a report.");
      return;
    }
    setBusyReportId(report.id);
    setReportError("");
    try {
      const response = await fetch(`/api/admin/reports/${encodeURIComponent(report.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      if (!response.ok) throw new Error(await errorFromResponse(response, "The report decision could not be saved."));
      await loadSafetyData(reportPage);
      await loadAudit(auditPage, auditFilter);
      await refreshOverview();
    } catch (caught) {
      setReportError(caught instanceof Error ? caught.message : "The report decision could not be saved.");
    } finally {
      setBusyReportId(null);
    }
  }

  async function restoreAuditTarget(entry: AuditEntry, reason: string) {
    const targetType = entry.targetPostId ? "post" : entry.targetProfileUserId ? "profile" : entry.targetJobId ? "job" : null;
    const targetId = entry.targetPostId ?? entry.targetProfileUserId ?? entry.targetJobId;
    if (!targetType || !targetId) return;
    setBusyReportId(entry.id);
    setAuditError("");
    try {
      const response = await fetch("/api/admin/moderation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, decision: "restore", reason }),
      });
      if (!response.ok) throw new Error(await errorFromResponse(response, "The restoration could not be saved."));
      setReasonAction(null);
      setDecisionReason("");
      await loadAudit(auditPage, auditFilter);
    } catch (caught) {
      setAuditError(caught instanceof Error ? caught.message : "The restoration could not be saved.");
    } finally {
      setBusyReportId(null);
    }
  }

  function searchMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMemberQuery(memberSearch.trim());
    void loadMembers(memberSearch.trim(), memberRole, 1);
  }

  const metrics = overview?.metrics;
  const totalPages = Math.max(1, Math.ceil(members.total / members.pageSize));

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/" className="admin-brand">
          <span className="admin-brand-mark">C</span>
          <span>CareerVerse<span>.</span><small>ADMIN CONSOLE</small></span>
        </Link>
        <p className="admin-nav-label">WORKSPACE</p>
        <a className="admin-nav-item admin-nav-active" href="#overview"><span>▦</span> Overview</a>
        <a className="admin-nav-item" href="#accounts"><span>♙</span> Members</a>
        <a className="admin-nav-item" href="#reviews"><span>✓</span> Recruiter reviews<em>{metrics?.pendingRecruiters ?? 0}</em></a>
        <a className="admin-nav-item" href="#jobs"><span>▤</span> Job listings</a>
        <a className="admin-nav-item" href="#reports"><span>⚑</span> Content reports<em>{reports.length}</em></a>
        <a className="admin-nav-item" href="#audit"><span>◷</span> Audit history</a>
        <p className="admin-nav-label admin-nav-label-lower">PRODUCT</p>
        <Link className="admin-nav-item" href="/jobs"><span>⌕</span> Job marketplace</Link>
        <Link className="admin-nav-item" href="/employer/jobs"><span>◫</span> Employer workspace</Link>
        <div className="admin-sidebar-bottom">
          <div className="admin-secure-note"><span>●</span><div><strong>Secure workspace</strong><small>Privileged access enabled</small></div></div>
          <Link href="/account" className="admin-back-link">← Back to account</Link>
        </div>
      </aside>

      <section className="admin-main" id="overview">
        <header className="admin-topbar">
          <div className="admin-breadcrumb">Workspace <span>/</span> Overview</div>
          <div className="admin-topbar-actions">
            <button className="admin-refresh-button" type="button" onClick={() => { void refreshOverview(); void loadSafetyData(reportPage); void loadAudit(auditPage, auditFilter); }} disabled={refreshing}>
              <span aria-hidden="true">↻</span> {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <div className="admin-user-chip"><span className="admin-avatar">{administratorName.trim().charAt(0).toUpperCase()}</span><span><strong>{administratorName}</strong><small>Administrator</small></span></div>
          </div>
        </header>

        <div className="admin-content">
          <div className="admin-welcome">
            <div><span className="admin-eyebrow">PLATFORM CONTROL CENTER</span><h1>Good to see you, {administratorName.split(/\s+/)[0]}</h1><p>Manage members, employer access, and the CareerVerse job marketplace.</p></div>
            <div className="admin-date"><span>●</span> Live platform data</div>
          </div>

          {error && <div className="admin-alert" role="alert">{error}</div>}
          {notice && <div className="admin-notice" role="status">{notice}</div>}

          <div className="admin-metrics">
            <article className="admin-metric-card"><div className="admin-metric-icon icon-violet">♙</div><span>Platform members</span><strong>{metrics ? numberFormat.format(metrics.users) : "—"}</strong><small><b>+{metrics ? numberFormat.format(metrics.newUsersThisWeek) : "—"}</b> joined this week</small></article>
            <article className="admin-metric-card"><div className="admin-metric-icon icon-blue">◈</div><span>Recruiter accounts</span><strong>{metrics ? numberFormat.format(metrics.recruiters) : "—"}</strong><small>Across the employer network</small></article>
            <article className="admin-metric-card"><div className="admin-metric-icon icon-amber">◷</div><span>Awaiting review</span><strong>{metrics ? numberFormat.format(metrics.pendingRecruiters) : "—"}</strong><small>Recruiter verification queue</small></article>
            <article className="admin-metric-card"><div className="admin-metric-icon icon-green">▤</div><span>Published opportunities</span><strong>{metrics ? numberFormat.format(metrics.publishedJobs) : "—"}</strong><small>Live, non-sample roles</small></article>
          </div>

          <div className="admin-lower-grid">
            <section className="admin-panel" id="reviews">
              <div className="admin-panel-heading"><div><span className="admin-eyebrow">TRUST & SAFETY</span><h2>Recruiter verification</h2><p>Review employers before they can publish roles.</p></div><span className="admin-count-pill">{metrics?.pendingRecruiters ?? 0} pending</span></div>
              {!overview ? <p className="admin-empty">The review queue could not be loaded.</p> : overview.pendingReviews.length === 0 ? <div className="admin-empty-state"><span>✓</span><strong>All caught up</strong><p>There are no recruiter accounts waiting for review.</p></div> : (
                <div className="admin-review-list">
                  {overview.pendingReviews.map((review) => <article className="admin-review-row" key={review.id}>
                    <div className="admin-review-avatar">{review.fullName.trim().charAt(0).toUpperCase()}</div>
                    <div className="admin-review-details"><strong>{review.fullName}</strong><span>{review.companyName || "Company not provided"} · {review.email}</span><small>Registered {dateLabel(review.createdAt)}</small></div>
                    <button type="button" className="admin-approve-button" disabled={busyId !== null} onClick={() => { setReasonAction({ type: "recruiter", id: review.id, verified: true }); setDecisionReason(""); }}>{busyId === review.id ? "Saving…" : "Verify employer"}</button>
                  </article>)}
                </div>
              )}
            </section>

            <section className="admin-panel admin-activity-panel">
              <div className="admin-panel-heading"><div><span className="admin-eyebrow">PLATFORM SNAPSHOT</span><h2>Community activity</h2><p>Current operating totals.</p></div></div>
              <div className="admin-activity-stat"><span>Applications submitted</span><strong>{metrics ? numberFormat.format(metrics.applications) : "—"}</strong></div>
              <div className="admin-activity-stat"><span>Verified employers</span><strong>{metrics ? numberFormat.format(metrics.recruiters - metrics.pendingRecruiters) : "—"}</strong></div>
              <div className="admin-activity-stat"><span>Employer listings managed</span><strong>{overview ? numberFormat.format(overview.jobs.length) : "—"}</strong></div>
              <div className="admin-activity-callout"><span>i</span><p>Job moderation and employer verification changes are recorded in the admin audit log.</p></div>
            </section>
          </div>

          <section className="admin-panel admin-recent-panel" id="accounts">
            <div className="admin-panel-heading"><div><span className="admin-eyebrow">MEMBER DIRECTORY</span><h2>Manage accounts</h2><p>Search platform members and review employer access.</p></div><span className="admin-count-pill admin-count-neutral">{numberFormat.format(members.total)} accounts</span></div>
            <form className="admin-member-filters" onSubmit={searchMembers}>
              <label className="admin-member-search"><span className="sr-only">Search name or email</span><span aria-hidden="true">⌕</span><input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Search name or email" maxLength={100} /></label>
              <label className="admin-role-filter"><span className="sr-only">Filter by account type</span><select value={memberRole} onChange={(event) => { const role = event.target.value as AdminUserRole; setMemberRole(role); setMemberQuery(memberSearch.trim()); void loadMembers(memberSearch.trim(), role, 1); }}>{roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
              <button className="admin-approve-button" type="submit">Search accounts</button>
            </form>
            {memberError && <p className="admin-inline-error" role="alert">{memberError}</p>}
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>MEMBER</th><th>ACCOUNT TYPE</th><th>STATUS</th><th>JOINED</th><th>ACTION</th></tr></thead><tbody>
              {members.users.map((member) => {
                const pending = member.role === "recruiter" && !member.recruiterVerified;
                return <tr key={member.id}>
                  <td><strong>{member.fullName}</strong><small>{member.email}</small></td>
                  <td>{roleLabel(member.role)}</td>
                  <td><span className={`admin-status ${pending ? "status-pending" : "status-active"}`}>{pending ? "Pending review" : member.role === "recruiter" ? "Verified" : "Active"}</span></td>
                  <td>{dateLabel(member.createdAt)}</td>
                  <td>{member.role === "recruiter" ? <button type="button" className={pending ? "admin-approve-button" : "admin-revoke-button"} disabled={busyId !== null} onClick={() => { setReasonAction({ type: "recruiter", id: member.id, verified: pending }); setDecisionReason(""); }}>{busyId === member.id ? "Saving…" : pending ? "Verify" : "Revoke"}</button> : <span className="admin-muted">—</span>}</td>
                </tr>;
              })}
              {members.users.length === 0 && <tr><td colSpan={5} className="admin-empty-cell">No accounts match these filters.</td></tr>}
            </tbody></table></div>
            <div className="admin-pagination"><span>Page {members.page} of {totalPages}</span><div><button type="button" disabled={members.page <= 1} onClick={() => void loadMembers(memberQuery, memberRole, members.page - 1)}>Previous</button><button type="button" disabled={members.page >= totalPages} onClick={() => void loadMembers(memberQuery, memberRole, members.page + 1)}>Next</button></div></div>
          </section>

          <section className="admin-panel admin-recent-panel" id="jobs">
            <div className="admin-panel-heading"><div><span className="admin-eyebrow">MARKETPLACE OVERSIGHT</span><h2>Employer job listings</h2><p>Close inappropriate listings or restore eligible roles.</p></div><span className="admin-count-pill admin-count-neutral">{overview?.jobs.length ?? 0} recent</span></div>
            {!overview || overview.jobs.length === 0 ? <p className="admin-empty">No employer-posted listings are available.</p> : <div className="admin-table-wrap"><table className="admin-table admin-jobs-table"><thead><tr><th>JOB</th><th>EMPLOYER</th><th>APPLICATIONS</th><th>STATUS</th><th>MODERATION</th></tr></thead><tbody>
              {overview.jobs.map((job) => <tr key={job.id}>
                <td><strong>{job.title}</strong><small>{job.companyName} · {job.location}</small></td>
                <td>{job.employerName}</td>
                <td>{numberFormat.format(job.applications)}</td>
                <td><span className={`admin-status ${job.status === "published" ? "status-active" : "status-pending"}`}>{job.status}</span></td>
                <td><select aria-label={`Change status for ${job.title}`} value={job.status} disabled={busyJobId !== null} onChange={(event) => { const status = event.target.value as "draft" | "published" | "closed"; if (status !== job.status) { setReasonAction({ type: "job-status", id: job.id, status }); setDecisionReason(""); } }}><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></select><button type="button" className={job.moderationHidden ? "admin-approve-button" : "admin-revoke-button"} disabled={busyJobId !== null} onClick={() => { setReasonAction({ type: "job-visibility", job }); setDecisionReason(""); }}>{job.moderationHidden ? "Restore" : "Hide"}</button></td>
              </tr>)}
            </tbody></table></div>}
          </section>
          <section className="admin-panel admin-recent-panel" id="reports">
            <div className="admin-panel-heading"><div><span className="admin-eyebrow">TRUST & SAFETY</span><h2>Content reports</h2><p>Review member reports for feed posts, public profiles, and employer listings.</p></div><span className="admin-count-pill">{reports.length} pending</span></div>
            {reportError && <p className="admin-inline-error" role="alert">{reportError}</p>}
            {reports.length === 0 ? <div className="admin-empty-state"><span>✓</span><strong>No pending reports</strong><p>New reports will appear here for review.</p></div> : <div className="admin-report-list">
              {reports.map((report) => <article className="admin-report-card" key={report.id}>
                <div className="admin-report-heading"><strong>{report.targetType.toUpperCase()} · {report.category.replaceAll("_", " ")}</strong><small>Reported by {report.reporterName} · {dateLabel(report.createdAt)}</small></div>
                <p className="admin-report-target"><strong>{report.targetOwner || "Content owner"}:</strong> {report.targetLabel}</p>
                {report.details && <p>{report.details}</p>}
                {report.targetType === "post" ? <Link href={`/networking/feed#post-${encodeURIComponent(report.targetId)}`} target="_blank" rel="noopener noreferrer">Open related content ↗</Link> : report.targetSlug && <Link href={report.targetType === "job" ? `/jobs/${encodeURIComponent(report.targetSlug)}` : `/profiles/${encodeURIComponent(report.targetSlug)}`} target="_blank" rel="noopener noreferrer">Open related content ↗</Link>}
                <label className="admin-report-reason">Decision reason
                  <textarea value={reportReasons[report.id] ?? ""} maxLength={1000} rows={2} onChange={(event) => setReportReasons((current) => ({ ...current, [report.id]: event.target.value}))} placeholder="Explain why the content is being hidden or the report dismissed." />
                </label>
                <div className="admin-report-actions">
                  {report.targetHidden ? <button type="button" className="admin-approve-button" disabled={busyReportId !== null} onClick={() => void reviewReport(report, "restore")}>{busyReportId === report.id ? "Saving…" : "Restore content"}</button> : <button type="button" className="admin-approve-button" disabled={busyReportId !== null} onClick={() => void reviewReport(report, "hide")}>{busyReportId === report.id ? "Saving…" : "Hide content"}</button>}
                  <button type="button" className="admin-revoke-button" disabled={busyReportId !== null} onClick={() => void reviewReport(report, "dismiss")}>Dismiss report</button>
                </div>
              </article>)}
            </div>}
            {reportTotal > 30 && <div className="admin-pagination"><span>Page {reportPage} of {Math.ceil(reportTotal / 30)} · {reportTotal} reports</span><div><button type="button" disabled={reportPage <= 1} onClick={() => void loadSafetyData(reportPage - 1)}>Previous</button><button type="button" disabled={reportPage >= Math.ceil(reportTotal / 30)} onClick={() => void loadSafetyData(reportPage + 1)}>Next</button></div></div>}
          </section>
          <section className="admin-panel admin-recent-panel" id="audit">
            <div className="admin-panel-heading"><div><span className="admin-eyebrow">ACCOUNTABILITY</span><h2>Admin audit history</h2><p>Recorded decisions include who acted, what changed, and the stated reason.</p></div><label className="admin-audit-filter"><span className="sr-only">Filter audit actions</span><select value={auditFilter} onChange={(event) => { const filter = event.target.value as AuditFilter; setAuditFilter(filter); void loadAudit(1, filter); }}><option value="all">All actions</option><option value="reports">Report decisions</option><option value="content">Content hide/restore</option><option value="jobs">Job controls</option><option value="recruiters">Recruiter verification</option></select></label></div>
            {auditError && <p className="admin-inline-error" role="alert">{auditError}</p>}
            {auditEntries.length === 0 ? <p className="admin-empty">No administrative actions have been recorded yet.</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>WHEN</th><th>ADMINISTRATOR</th><th>ACTION / TARGET</th><th>REASON</th><th>FOLLOW-UP</th></tr></thead><tbody>
              {auditEntries.map((entry) => {
                const hiddenTarget = entry.action.endsWith("_hidden");
                const target = entry.targetPostId ? "post" : entry.targetProfileUserId ? "profile" : entry.targetJobId ? "job" : null;
                const targetName = entry.targetPostBody ?? entry.targetProfileName ?? entry.targetJobTitle ?? entry.targetUserName ?? "Content";
                return <tr key={entry.id}>
                  <td>{dateLabel(entry.createdAt)}</td><td>{entry.actorName}</td>
                  <td><strong>{entry.action.replaceAll("_", " ")}</strong><small>{targetName.slice(0, 120)}</small></td>
                  <td>{entry.reason || "Historical action (no reason recorded)"}</td>
                  <td>{hiddenTarget && Boolean(entry.targetHidden) && target ? <button type="button" className="admin-revoke-button" disabled={busyReportId !== null} onClick={() => { setReasonAction({ type: "restore-audit", entry }); setDecisionReason(""); }}>{busyReportId === entry.id ? "Restoring…" : "Restore content"}</button> : <span className="admin-muted">—</span>}</td>
                </tr>;
              })}
            </tbody></table></div>}
            {auditTotal > 50 && <div className="admin-pagination"><span>Page {auditPage} of {Math.ceil(auditTotal / 50)} · {auditTotal} actions</span><div><button type="button" disabled={auditPage <= 1} onClick={() => void loadAudit(auditPage - 1, auditFilter)}>Previous</button><button type="button" disabled={auditPage >= Math.ceil(auditTotal / 50)} onClick={() => void loadAudit(auditPage + 1, auditFilter)}>Next</button></div></div>}
          </section>
          <footer className="admin-footer">CareerVerse administration <span>•</span> Privileged actions are checked server-side and logged.</footer>
        </div>
      </section>
      {reasonAction && (
        <div className="admin-dialog-backdrop">
          <section className="admin-review-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-reason-title">
            <h2 id="admin-reason-title">
              {reasonAction.type === "recruiter"
                ? reasonAction.verified ? "Verify employer" : "Revoke employer access"
                : reasonAction.type === "job-status" ? "Change job status"
                : reasonAction.type === "job-visibility"
                  ? reasonAction.job.moderationHidden ? "Restore listing" : "Hide listing"
                  : "Restore content"}
            </h2>
            <p>Enter a reason for this decision. It will be recorded in the admin audit log.</p>
            <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const reason = decisionReason.trim();
              if (reason.length < 3) return;
              if (reasonAction.type === "recruiter") {
                void reviewRecruiter(reasonAction.id, reasonAction.verified, reason);
              } else if (reasonAction.type === "job-status") {
                void moderateJob(reasonAction.id, reasonAction.status, reason);
              } else if (reasonAction.type === "job-visibility") {
                void toggleJobVisibility(reasonAction.job, reason);
              } else {
                void restoreAuditTarget(reasonAction.entry, reason);
              }
            }}>
              <label htmlFor="admin-decision-reason">Decision reason</label>
              <textarea
                id="admin-decision-reason"
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                minLength={3}
                maxLength={1000}
                rows={4}
                required
                autoFocus
              />
              <div className="admin-review-dialog-actions">
                <button type="button" className="admin-revoke-button" disabled={busyId !== null || busyJobId !== null || busyReportId !== null} onClick={() => setReasonAction(null)}>Cancel</button>
                <button type="submit" className="admin-approve-button" disabled={busyId !== null || busyJobId !== null || busyReportId !== null}>
                  {busyId !== null || busyJobId !== null || busyReportId !== null ? "Saving…" : reasonAction.type === "recruiter" ? reasonAction.verified ? "Confirm verification" : "Confirm revocation" : reasonAction.type === "job-status" ? "Confirm status change" : reasonAction.type === "job-visibility" ? reasonAction.job.moderationHidden ? "Confirm restore" : "Confirm hide" : "Confirm restore"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
