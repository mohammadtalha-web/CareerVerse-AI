"use client";

import { useState } from "react";

const statuses = ["applied", "screening", "interview", "offer", "rejected"] as const;
type ApplicationStatus = (typeof statuses)[number] | "withdrawn";

export default function EmployerApplicationStatus({
  id,
  initialStatus,
}: {
  id: string;
  initialStatus: ApplicationStatus;
}) {
  const [status, setStatus] = useState<ApplicationStatus>(initialStatus);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function update(nextStatus: ApplicationStatus) {
    if (nextStatus === status || !statuses.includes(nextStatus as (typeof statuses)[number])) return;
    const previous = status;
    setStatus(nextStatus);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/employer/applications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "We couldn't update this application.";
        setStatus(previous);
        setError(message);
      }
    } catch {
      setStatus(previous);
      setError("Hiring tools could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="employer-application-status">
      <label className="employer-application-status-label">
        <span>Move to</span>
        <select
          aria-label={`Update application status, currently ${status}`}
          value={status}
          disabled={busy || status === "rejected" || status === "withdrawn"}
          onChange={(event) => void update(event.target.value as ApplicationStatus)}
        >
          {status === "withdrawn" && <option value="withdrawn">Withdrawn</option>}
          {statuses.map((value) => <option key={value} value={value}>{value === "applied" ? "New application" : value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
        </select>
      </label>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}