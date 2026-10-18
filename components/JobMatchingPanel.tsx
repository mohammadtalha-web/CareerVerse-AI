"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

type CandidateJob = {
  slug: string;
  title: string;
};

type Match = {
  slug: string;
  score: number;
  reasons: string[];
};

export default function JobMatchingPanel({ jobs }: { jobs: CandidateJob[] }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    setMatches([]);
    try {
      const response = await fetch("/api/jobs/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slugs: jobs.map((job) => job.slug),
          skills: data.get("skills"),
          targetTitles: data.get("targetTitles"),
          country: data.get("country"),
          consent: data.get("consent") === "on",
        }),
      });
      const result: unknown = await response.json().catch(() => null);
      const message =
        typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : "AI matching could not be completed.";
      if (!response.ok) {
        setError(message);
        return;
      }
      if (
        typeof result === "object" &&
        result !== null &&
        "matches" in result &&
        Array.isArray(result.matches)
      ) {
        setMatches(result.matches as Match[]);
      } else {
        setError("The matching service returned an invalid response.");
      }
    } catch {
      setError("The matching service could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="job-matching-panel card card-pad" aria-labelledby="job-match-heading">
      <div>
        <span className="section-kicker">AI JOB MATCHING</span>
        <h2 id="job-match-heading">Find roles that fit your skills</h2>
        <p>Only job-related details are processed by the local AI model; your name and email are not included.</p>
      </div>
      <form className="job-matching-form" onSubmit={submit}>
        <label>Skills<input name="skills" placeholder="e.g. Python, SQL, project management" maxLength={1_000} required /></label>
        <label>Roles you’re interested in<input name="targetTitles" placeholder="e.g. Data analyst, product analyst" maxLength={300} required /></label>
        <label>Preferred country code<input name="country" placeholder="e.g. BD, US, GB" pattern="[A-Za-z]{2}" maxLength={2} required /></label>
        <label className="job-matching-consent">
          <input name="consent" type="checkbox" required />
          <span>I agree to process these skills, role preferences, and visible job descriptions with the local AI model on this CareerVerse server.</span>
        </label>
        <button className="btn btn-violet" disabled={busy || jobs.length === 0}>
          {busy ? "Finding matches…" : "Find AI matches"}
        </button>
      </form>
      <p className="job-matching-notice">Matching runs locally on the CareerVerse server. Avoid sensitive personal information. Results are suggestions, not hiring decisions.
      </p>
      {error && <p className="job-matching-error" role="alert">{error}</p>}
      {matches.length > 0 && (
        <div className="job-matching-results" aria-live="polite">
          <h3>Ranked job suggestions</h3>
          {matches.map((match) => {
            const job = jobs.find((candidate) => candidate.slug === match.slug);
            if (!job) return null;
            return (
              <article key={match.slug}>
                <div><Link href={`/jobs/${match.slug}`}>{job.title}</Link><strong>{match.score}% fit</strong></div>
                <ul>{match.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
