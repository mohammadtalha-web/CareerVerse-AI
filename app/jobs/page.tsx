import { Fragment } from "react";
import Link from "next/link";
import type { RowDataPacket } from "mysql2";
import JobActions from "@/components/JobActions";
import JobMatchingPanel from "@/components/JobMatchingPanel";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable } from "@/lib/http";
import { searchJobs } from "@/lib/job-repository";
import { recordJobSearch } from "@/lib/notifications";

type SearchParams = Record<string, string | string[] | undefined>;

function getValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function escapeForHighlight(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(value: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return value;
  const terms = trimmed.split(/\s+/).filter(Boolean).map((term) => term.toLowerCase());
  if (terms.length === 0) return value;
  const regex = new RegExp(`(${terms.map(escapeForHighlight).join("|")})`, "ig");
  const segments = value.split(regex);
  return segments.map((segment, index) => {
    const matched = typeof segment === "string" && terms.some((term) => segment.toLowerCase() === term);
    return matched ? <mark key={`${segment}-${index}`} className="search-highlight">{segment}</mark> : <Fragment key={`${segment}-${index}`}>{segment}</Fragment>;
  });
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const query = getValues(params.query)[0] ?? "";
  const location = getValues(params.location)[0] ?? "";
  const country = getValues(params.country)[0] ?? "";
  const selectedEmployment = getValues(params.employmentType)[0] ?? "";
  const selectedWorkplace = getValues(params.workplaceType)[0] ?? "";
  const sourceType = getValues(params.sourceType)[0] ?? "";
  const page = Math.max(1, Number.parseInt(getValues(params.page)[0] ?? "1", 10) || 1);
  let searchResult;
  let searchError = "";
  try {
    searchResult = await searchJobs({
      query,
      location,
      country,
      employmentType: selectedEmployment,
      workplaceType: selectedWorkplace,
      sourceType,
      page,
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      searchError = "Live job search is temporarily unavailable. Check that MySQL is running and database/schema.sql has been applied.";
    } else {
      console.error("Unable to render job search results.", error);
      searchError = "We couldn't load job results. Please adjust your search or try again.";
    }
  }
  const jobs = searchResult?.jobs ?? [];
  const appliedJobIds = new Set<number>();
  let applicationStatusUnavailable = false;
  let isAuthenticated = false;
  let account: Awaited<ReturnType<typeof getCurrentAccount>> = null;
  try {
    account = await getCurrentAccount();
    isAuthenticated = account !== null;
  } catch (error) {
    console.error("Unable to verify the current account for job actions.", error);
  }
  const trackableJobIds = jobs.flatMap((job) =>
    !job.isSample && !job.external && job.id !== undefined ? [job.id] : [],
  );
  if (trackableJobIds.length > 0 && account?.role === "job_seeker") {
    try {
      const placeholders = trackableJobIds.map(() => "?").join(", ");
      const [rows] = await getDatabase().execute<(RowDataPacket & { jobId: number })[]>(
        `SELECT job_id AS jobId FROM applications
         WHERE user_id = ? AND job_id IN (${placeholders})`,
        [account.id, ...trackableJobIds],
      );
      for (const row of rows) appliedJobIds.add(Number(row.jobId));
    } catch (error) {
      console.error("Unable to check application status for job search results.", error);
      applicationStatusUnavailable = true;
    }
  }
  if (query.trim() || location.trim()) {
    try {
      const account = await getCurrentAccount();
      if (account) {
        await recordJobSearch(account.id, query, location);
      }
    } catch (error) {
      console.error("Recording a member job search failed.", error);
    }
  }
  const total = searchResult?.total ?? 0;
  const mode = searchResult?.mode ?? "live";
  const pageSize = searchResult?.pageSize ?? 12;
  const pageCount = Math.ceil(total / pageSize);
  const queryString = (nextPage: number) => {
    const values = new URLSearchParams();
    if (query) values.set("query", query);
    if (location) values.set("location", location);
    if (country) values.set("country", country);
    if (selectedEmployment) values.set("employmentType", selectedEmployment);
    if (selectedWorkplace) values.set("workplaceType", selectedWorkplace);
    if (sourceType) values.set("sourceType", sourceType);
    if (nextPage > 1) values.set("page", String(nextPage));
    return `/jobs?${values.toString()}`;
  };

  return (
    <main className="jobs-page">
      <div className="wrap">
        <div className="crumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><b>Find jobs</b></div>
        <div className="jobs-intro">
          <div><span className="section-kicker">YOUR NEXT MOVE</span><h1>Find work that <span>fits you.</span></h1><p>Search across countries, job sources, employment types, and work styles.</p></div>
          <div className="jobs-intro-note"><span>✳</span><div><strong>A little more you, in every search.</strong><small>Search by role, company, or where you want to work.</small></div></div>
        </div>

        <form action="/jobs" method="get" className="jobs-search-form">
          <label className="search-field"><span aria-hidden="true">⌕</span><span className="sr-only">Job title, skill, or company</span><input name="query" placeholder="Job title, skill, or company" defaultValue={query} /></label>
          <label className="search-field"><span aria-hidden="true">⌖</span><span className="sr-only">City or region</span><input name="location" placeholder="City or region" defaultValue={location} /></label>
          <button className="btn btn-violet" type="submit">Search jobs <span aria-hidden="true">→</span></button>
        </form>

        <div className="jobs-results-layout">
          <form action="/jobs" method="get" className="filter-rail jobs-filter-rail">
            <input type="hidden" name="query" value={query} />
            <input type="hidden" name="location" value={location} />
            <div className="filter-heading"><h2>Refine your search</h2><Link href="/jobs">Reset</Link></div>
            <fieldset>
              <legend>Country code</legend>
              <label className="sr-only" htmlFor="jobs-country">Two-letter country code</label>
              <input id="jobs-country" name="country" placeholder="e.g. BD, US, GB" maxLength={2} defaultValue={country} />
            </fieldset>
            <fieldset>
              <legend>Employment type</legend>
              <label className="sr-only" htmlFor="jobs-employment-type">Employment type</label>
              <select id="jobs-employment-type" name="employmentType" defaultValue={selectedEmployment}>
                <option value="">All employment types</option>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="internship">Internship</option>
                <option value="temporary">Temporary</option>
              </select>
            </fieldset>
            <fieldset>
              <legend>Work style</legend>
              <label className="sr-only" htmlFor="jobs-workplace-type">Work style</label>
              <select id="jobs-workplace-type" name="workplaceType" defaultValue={selectedWorkplace}>
                <option value="">All work styles</option>
                <option value="onsite">On-site</option>
                <option value="hybrid">Hybrid</option>
                <option value="remote">Remote</option>
              </select>
            </fieldset>
            <fieldset>
              <legend>Source</legend>
              <label className="sr-only" htmlFor="jobs-source-type">Job source</label>
              <select id="jobs-source-type" name="sourceType" defaultValue={sourceType}>
                <option value="">Government &amp; private</option>
                <option value="government">Government</option>
                <option value="private">Private</option>
              </select>
            </fieldset>
            <button className="btn btn-violet filter-apply" type="submit">Apply filters</button>
          </form>

          <div className="jobs-results">
            <div className="jobs-results-heading">
              <div><h2>{searchError ? "Job search unavailable" : total ? `${total} ${total === 1 ? "opportunity" : "opportunities"} to explore` : "No roles found just yet"}</h2><p>{query || location ? <>Results for {query && <strong>“{query}”</strong>}{query && location ? " near " : ""}{location && <strong>“{location}”</strong>}</> : "A curated starting point for your next move."}</p></div>
              <span className={`results-live${mode === "demo" ? " results-demo" : ""}`}><i /> {mode === "demo" ? "Sample listings" : "Live catalog"}</span>
            </div>
            <div className="jobs-list">
              {searchError ? (
                <div className="jobs-empty-state"><span>!</span><h3>Live listings aren’t available right now</h3><p>{searchError}</p></div>
              ) : jobs.length ? jobs.map((job) => (
                <article key={job.slug} className="job-result-card">
                  <div className="result-company-logo">{job.initials}</div>
                  <div className="result-job-content">
                    <div className="result-company-name">{highlightText(job.company, query)}<span className="result-tag">{job.isSample ? "Sample" : job.sourceType === "government" ? "Government" : "Private"}</span></div>
                    <h3><Link href={`/jobs/${job.slug}`}>{highlightText(job.title, query)}</Link></h3>
                    <p>{highlightText(job.location, query)}<i />{job.type}<i />{job.experience}</p>
                    <div className="result-job-bottom"><span>◷ {job.posted}</span><span>{job.sourceName} · {job.countryCode}</span></div>
                  </div>
                  <div className="job-result-actions">
                    <Link href={`/jobs/${job.slug}`} className="btn btn-line">Details</Link>
                    <JobActions
                      slug={job.slug}
                      jobId={job.id}
                      isSample={job.isSample}
                      external={job.external}
                      sourceName={job.sourceName}
                      applyUrl={job.applyUrl}
                      isAuthenticated={isAuthenticated}
                      alreadyApplied={job.id !== undefined && appliedJobIds.has(job.id)}
                      applicationStatusUnavailable={applicationStatusUnavailable && !job.isSample && !job.external && job.id !== undefined}
                    />
                  </div>
                  {job.match !== null && <div className="result-match"><strong>{job.match}%</strong><span>AI match</span></div>}
                </article>
              )) : (
                <div className="jobs-empty-state"><span>⌕</span><h3>Try a broader search</h3><p>Change your keywords or location, or reset your filters to see more opportunities.</p><Link href="/jobs" className="btn btn-violet">Clear search</Link></div>
              )}
            </div>
            {pageCount > 1 && <nav className="jobs-pagination" aria-label="Job search pages">
              {page > 1 && <Link className="btn btn-line" href={queryString(page - 1)}>Previous</Link>}
              <span>Page {page} of {pageCount}</span>
              {page < pageCount && <Link className="btn btn-line" href={queryString(page + 1)}>Next</Link>}
            </nav>}
            <p className="jobs-disclaimer">{mode === "demo" ? "Showing clearly labelled sample listings because no live database is configured. These are not current vacancies and cannot be applied to." : "Listings are shown with the source and application route provided. Always review the source details before applying."}</p>
          </div>
          <aside className="jobs-side-panel">
            <JobMatchingPanel jobs={jobs.filter((job) => !job.isSample).map((job) => ({ slug: job.slug, title: job.title }))} />
          </aside>
        </div>
      </div>
    </main>
  );
}
