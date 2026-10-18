"use client";

import { useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import ReportContentButton from "@/components/ReportContentButton";

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export default function JobActions({
  slug,
  isSample,
  external,
  sourceName,
  applyUrl,
  isAuthenticated,
  jobId,
  alreadyApplied = false,
  applicationStatusUnavailable = false,
}: {
  slug: string;
  isSample: boolean;
  external: boolean;
  sourceName: string;
  applyUrl: string | null;
  isAuthenticated: boolean;
  jobId?: number;
  alreadyApplied?: boolean;
  applicationStatusUnavailable?: boolean;
}) {
  const [busy, setBusy] = useState<"apply" | "save" | null>(null);
  const [saved, setSaved] = useState(false);
  const [applied, setApplied] = useState(alreadyApplied);
  const [message, setMessage] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [applyDialog, setApplyDialog] = useState(false);

  async function submit(path: "applications" | "saved", applicationForm?: HTMLFormElement) {
    setBusy(path === "applications" ? "apply" : "save");
    setMessage("");
    setRequiresLogin(false);
    try {
      const response = path === "applications" && applicationForm
        ? await fetch(`/api/jobs/${encodeURIComponent(slug)}/${path}`, {
            method: "POST",
            body: new FormData(applicationForm),
          })
        : await fetch(`/api/jobs/${encodeURIComponent(slug)}/${path}`, {
            method: path === "saved" && saved ? "DELETE" : "POST",
            headers: { "Content-Type": "application/json" },
          });
      const result: unknown = await response.json().catch(() => null);
      const data =
        typeof result === "object" && result !== null
          ? (result as { error?: unknown; message?: unknown; saved?: unknown; action?: unknown })
          : null;

      if (response.status === 401) {
        setRequiresLogin(true);
        setMessage("Sign in to use this feature.");
        return;
      }
      if (!response.ok) {
        setMessage(
          data && typeof data.error === "string"
            ? data.error
            : "We couldn't complete that action. Please try again.",
        );
        if (path === "applications" && data?.error === "You have already applied to this role.") {
          setApplied(true);
          setApplyDialog(false);
        }
        return;
      }
      if (path === "saved") {
        setSaved(Boolean(data?.saved));
        setMessage(data?.saved ? "Opportunity saved to your account." : "Opportunity removed from saved jobs.");
      } else {
        setApplied(data?.action === "applied");
        setApplyDialog(false);
        setMessage(
          typeof data?.message === "string"
            ? data.message
            : "Your application was submitted.",
        );
      }
    } catch {
      setMessage("The service couldn't be reached. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="job-actions">
      {!isAuthenticated ? (
        <Link className="btn btn-violet" href="/login">
          Log in to apply
        </Link>
      ) : external ? (
        applyUrl ? (
          <a className="btn btn-violet" href={applyUrl} target="_blank" rel="noopener noreferrer">
            Apply on {sourceName} <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="job-action-unavailable">Application link unavailable</span>
        )
      ) : (
        <button
          className="btn btn-violet"
          type="button"
          disabled={isSample || busy !== null || applied || applicationStatusUnavailable}
          onClick={() => setApplyDialog(true)}
        >
          {busy === "apply"
            ? "Submitting…"
            : applied
              ? "Applied ✓"
              : applicationStatusUnavailable
                ? "Status unavailable"
                : "Apply now"}
        </button>
      )}
      <button
        className="btn btn-line"
        type="button"
        disabled={isSample || busy !== null}
        onClick={() => void submit("saved")}
      >
        {busy === "save" ? "Saving…" : saved ? "Saved ✓" : "Save job"}
      </button>
      {isSample && <small className="job-action-note">Sample listings cannot be applied to or saved.</small>}
      {applicationStatusUnavailable && <p className="job-action-message" role="status">We couldn’t verify your application status. Refresh the page before applying.</p>}
      {jobId && !isSample && !external && <ReportContentButton targetType="job" targetId={jobId} />}
      {message && (
        <p className="job-action-message" role="status">
          {message} {requiresLogin && <Link href="/login">Log in</Link>}
        </p>
      )}
      {applyDialog && createPortal(
        <div className="application-dialog-backdrop" role="presentation" onClick={(event) => {
          if (event.target === event.currentTarget && busy === null) setApplyDialog(false);
        }}>
          <section className="application-dialog" role="dialog" aria-modal="true" aria-labelledby={`apply-title-${slug}`}>
            <button className="application-dialog-close" type="button" aria-label="Close application form" onClick={() => setApplyDialog(false)} disabled={busy !== null}>×</button>
            <span className="section-kicker">YOUR APPLICATION</span>
            <h2 id={`apply-title-${slug}`}>Apply for this role</h2>
            <p>Attach a resume if you want the employer to review it. PDF or DOCX, maximum 5 MB.</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const resume = form.elements.namedItem("resume");
              if (resume instanceof HTMLInputElement && resume.files?.[0] && resume.files[0].size > MAX_RESUME_BYTES) {
                resume.setCustomValidity("Your resume must be 5 MB or smaller.");
                resume.reportValidity();
                return;
              }
              if (!form.reportValidity()) return;
              void submit("applications", form);
            }}>
              <label className="application-dialog-field">Resume (optional)
                <input
                  name="resume"
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => event.currentTarget.setCustomValidity("")}
                />
              </label>
              <label className="application-dialog-field">Cover letter (optional)
                <textarea name="coverLetter" maxLength={5000} rows={5} placeholder="Share why this role interests you." />
              </label>
              <label className="ai-provider-consent application-ai-consent">
                <input name="aiScreeningConsent" type="checkbox" />
                <span>I consent to optional AI screening of my resume using the local AI model on this CareerVerse server for this role. Declining will not prevent me from applying.</span>
              </label>
              <p className="application-privacy-note">Your resume is not shown on your public profile. If you opt in, it is processed by the local AI model on this CareerVerse server. AI screening is advisory; people make hiring decisions.
              </p>
              {message && <p className="account-form-error" role="alert">{message}</p>}
              <div className="application-dialog-actions">
                <button className="btn btn-line" type="button" disabled={busy !== null} onClick={() => setApplyDialog(false)}>Cancel</button>
                <button className="btn btn-violet" type="submit" disabled={busy !== null}>{busy === "apply" ? "Submitting…" : "Submit application"}</button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}