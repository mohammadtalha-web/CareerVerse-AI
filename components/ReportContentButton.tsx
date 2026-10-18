"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

const categories = [
  ["spam_scam", "Spam or scam"],
  ["harassment", "Harassment"],
  ["inappropriate", "Inappropriate content"],
  ["misleading", "Misleading information"],
  ["other", "Other"],
] as const;

export default function ReportContentButton({
  targetType,
  targetId,
}: {
  targetType: "post" | "profile" | "job";
  targetId: number;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof categories)[number][0]>("spam_scam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [login, setLogin] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setLogin(false);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, category, details }),
      });
      const result: unknown = await response.json().catch(() => null);
      const error = typeof result === "object" && result !== null && "error" in result &&
        typeof result.error === "string" ? result.error : "We couldn't submit your report.";
      if (response.status === 401) {
        setLogin(true);
        setMessage("Sign in to report this content.");
      } else if (!response.ok) {
        setMessage(error);
      } else {
        setMessage("Report submitted. Our moderation team will review it.");
        setOpen(false);
      }
    } catch {
      setMessage("The service couldn't be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="report-content-control">
      <button className="btn btn-line" type="button" onClick={() => setOpen((current) => !current)}>
        {open ? "Cancel report" : "Report"}
      </button>
      {open && <form className="report-content-form" onSubmit={(event) => void submit(event)}>
        <label>Reason
          <select value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number][0])}>
            {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Details (optional)
          <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={1000} rows={3} />
        </label>
        <button className="btn btn-violet" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit report"}</button>
      </form>}
      {message && <p role={login ? "alert" : "status"}>{message} {login && <Link href="/login">Log in</Link>}</p>}
    </div>
  );
}
