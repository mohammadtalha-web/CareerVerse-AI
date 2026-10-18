"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

type Profile = {
  slug: string;
  companyName: string;
  industry: string;
  headquarters: string;
  websiteUrl: string;
  description: string;
  employeeCount: string;
};

type Reports = {
  openings: number;
  pipeline: Array<{ status: string; total: number }>;
  monthlyApplications: Array<{ month: string; total: number }>;
  advertisedSalaryRanges: Array<{ currency: string; period: string; roles: number; minimum: number; maximum: number }>;
};

const empty: Profile = {
  slug: "",
  companyName: "",
  industry: "",
  headquarters: "",
  websiteUrl: "",
  description: "",
  employeeCount: "",
};

function formatReportMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return value;
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(
    new Date(Number(match[1]), month - 1, 1),
  );
}

export default function EmployerCompanyProfile() {
  const [profile, setProfile] = useState<Profile>(empty);
  const [reports, setReports] = useState<Reports | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/employer/company-profile", { cache: "no-store" }),
      fetch("/api/employer/reports", { cache: "no-store" }),
    ]).then(async ([profileResponse, reportResponse]) => {
      const profileData: unknown = await profileResponse.json();
      const reportData: unknown = await reportResponse.json();
      if (!profileResponse.ok || !reportResponse.ok) throw new Error("Company profile and reports could not be loaded.");
      if (!active) return;
      if (typeof profileData === "object" && profileData !== null && "profile" in profileData && profileData.profile) {
        const company = profileData.profile as Partial<Profile>;
        setProfile({
          slug: typeof company.slug === "string" ? company.slug : "",
          companyName: company.companyName ?? "",
          industry: company.industry ?? "",
          headquarters: company.headquarters ?? "",
          websiteUrl: company.websiteUrl ?? "",
          description: company.description ?? "",
          employeeCount: company.employeeCount == null ? "" : String(company.employeeCount),
        });
      }
      if (typeof reportData === "object" && reportData !== null && "pipeline" in reportData) {
        setReports(reportData as Reports);
      }
      setError("");
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Company data could not be loaded.");
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/employer/company-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Company profile could not be saved.");
      }
      if (typeof payload === "object" && payload !== null && "slug" in payload && typeof payload.slug === "string") {
        const savedSlug = payload.slug;
        setProfile((current) => ({ ...current, slug: savedSlug }));
      }
      setStatus("Company profile saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Company profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const update = (key: keyof Profile, value: string) => setProfile((current) => ({ ...current, [key]: value }));

  return (
    <div className="employer-company-workspace">
      <section className="card card-pad employer-job-section employer-company-profile-section" aria-labelledby="employer-company-profile-heading">
        <div className="employer-section-heading">
          <div><span className="section-kicker">YOUR VERIFIED COMPANY</span><h2 id="employer-company-profile-heading">Company profile</h2><p>Keep your public company details accurate and up to date.</p></div>
          <span className="employer-section-mark employer-section-mark-company" aria-hidden="true">C</span>
        </div>
        <p className="employer-company-profile-note">Employee count is self-reported. Only a verified recruiter account can manage this profile.</p>
        {busy ? <p>Loading company profile…</p> : (
          <form className="employer-job-form" onSubmit={(event) => void save(event)}>
            <label>Company name<input required maxLength={160} value={profile.companyName} onChange={(event) => update("companyName", event.target.value)} /></label>
            <label>Industry<input maxLength={120} value={profile.industry} onChange={(event) => update("industry", event.target.value)} /></label>
            <label>Headquarters<input maxLength={180} value={profile.headquarters} onChange={(event) => update("headquarters", event.target.value)} /></label>
            <label>Company website<input type="url" maxLength={2048} placeholder="https://" value={profile.websiteUrl} onChange={(event) => update("websiteUrl", event.target.value)} /></label>
            <label>Employee count (self-reported)<input type="number" min="0" max="10000000" step="1" value={profile.employeeCount} onChange={(event) => update("employeeCount", event.target.value)} /></label>
            <label className="employer-job-form-wide">About the company<textarea rows={5} maxLength={5000} value={profile.description} onChange={(event) => update("description", event.target.value)} /></label>
            {error && <p className="account-form-error employer-job-form-wide" role="alert">{error}</p>}
            {status && <p className="employer-job-form-success employer-job-form-wide" role="status">{status}</p>}
            <div className="employer-company-actions employer-job-form-wide">
              <button className="btn btn-violet" type="submit" disabled={saving || busy}>{saving ? "Saving…" : "Save company profile"}</button>
              <Link className="btn btn-line" href="/companies">View company directory</Link>
            {profile.slug && <Link className="btn btn-line" href={`/companies/${encodeURIComponent(profile.slug)}`}>View your public profile</Link>}
            </div>
          </form>
        )}
      </section>

      <section className="card card-pad employer-job-section employer-report-section" aria-labelledby="employer-report-heading">
        <div className="employer-section-heading">
          <div><span className="section-kicker">ACTUAL CAREERVERSE DATA</span><h2 id="employer-report-heading">Hiring and pay transparency</h2><p>Reporting from your CareerVerse roles and applications.</p></div>
          <span className="employer-section-mark employer-section-mark-report" aria-hidden="true">↗</span>
        </div>
        <p className="employer-report-note">Advertised pay is employer-provided and does not represent employee wages or market salary data.</p>
        {reports ? <>
          <div className="employer-report-stats">
            <article><strong>{reports.openings}</strong><span>Current live roles</span></article>
            {reports.pipeline.map((entry) => <article key={entry.status}><strong>{entry.total}</strong><span>{entry.status} applications</span></article>)}
          </div>
          <h3>Advertised salary ranges</h3>
          {reports.advertisedSalaryRanges.length ? (
            <div className="employer-salary-report">
              {reports.advertisedSalaryRanges.map((salary) => <p key={`${salary.currency}-${salary.period}`}>
                <strong>{salary.currency} {salary.minimum.toLocaleString()}–{salary.maximum.toLocaleString()} / {salary.period}</strong>
                <span>Advertised across {salary.roles} live {salary.roles === 1 ? "role" : "roles"}</span>
              </p>)}
            </div>
          ) : <p>No structured salary ranges are published for your current live roles.</p>}
          <h3>Applications over the last 12 months</h3>
          {reports.monthlyApplications.length ? (
            <div className="employer-month-report">{reports.monthlyApplications.map((month) => <p key={month.month}><span>{formatReportMonth(month.month)}</span><strong>{month.total}</strong></p>)}</div>
          ) : <p>No applications have been recorded in the last 12 months.</p>}
        </> : busy
          ? <p className="employer-report-loading" role="status">Loading your hiring report…</p>
          : <p className="account-form-error employer-report-error" role="alert">{error || "Your hiring report could not be loaded. Please refresh and try again."}</p>}
      </section>
    </div>
  );
}
