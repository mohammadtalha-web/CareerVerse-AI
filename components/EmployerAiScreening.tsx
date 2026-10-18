"use client";

import { useState } from "react";

type ScreeningResult = {
  score: number;
  strengths: string[];
  gaps: string[];
  evidence: string[];
  questions: string[];
  caveat: string;
};

export default function EmployerAiScreening({
  applicationId,
  consented,
  hasResume,
  initialResult,
}: {
  applicationId: string;
  consented: boolean;
  hasResume: boolean;
  initialResult: ScreeningResult | null;
}) {
  const [result, setResult] = useState(initialResult);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function screen() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/employer/applications/${encodeURIComponent(applicationId)}/screen`, {
        method: "POST",
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "AI screening could not be completed.",
        );
      }
      if (typeof payload !== "object" || payload === null || !("result" in payload)) {
        throw new Error("AI screening returned an invalid response.");
      }
      setResult(payload.result as ScreeningResult);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "AI screening could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (!consented) return <small className="screening-availability">Candidate has not opted in to local AI screening under the current disclosure. Review this application manually.</small>;
  if (!hasResume) return <small className="screening-availability">No resume provided for screening.</small>;

  return (
    <div className="employer-ai-screening">
      <button className="btn btn-line" type="button" onClick={() => void screen()} disabled={busy}>
        {busy ? "Analyzing…" : result ? `AI review · ${result.score}/100` : "AI review (optional)"}
      </button>
      {error && <small className="screening-error" role="alert">{error}</small>}
      {result && (
        <details className="screening-result">
          <summary>View advisory screening details</summary>
          <p>{result.caveat}</p>
          {result.strengths.length > 0 && <><strong>Relevant stated evidence</strong><ul>{result.strengths.map((item, index) => <li key={`s-${index}`}>{item}</li>)}</ul></>}
          {result.gaps.length > 0 && <><strong>Points to clarify (not assumed missing)</strong><ul>{result.gaps.map((item, index) => <li key={`g-${index}`}>{item}</li>)}</ul></>}
          {result.evidence.length > 0 && <><strong>Resume evidence</strong><ul>{result.evidence.map((item, index) => <li key={`e-${index}`}>{item}</li>)}</ul></>}
          {result.questions.length > 0 && <><strong>Consistent follow-up questions</strong><ul>{result.questions.map((item, index) => <li key={`q-${index}`}>{item}</li>)}</ul></>}
        </details>
      )}
    </div>
  );
}
