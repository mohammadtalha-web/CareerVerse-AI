"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { jobCountries } from "@/lib/countries";

export default function EmployerJobForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [otherCountry, setOtherCountry] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/employer/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.get("title"),
          company: data.get("company"),
          location: data.get("location"),
          countryCode: otherCountry ? data.get("countryCodeManual") : data.get("countryCode"),
          employmentType: data.get("employmentType"),
          workplaceType: data.get("workplaceType"),
          experience: data.get("experience"),
          salary: data.get("salary"),
          salaryMin: data.get("salaryMin"),
          salaryMax: data.get("salaryMax"),
          salaryCurrency: data.get("salaryCurrency"),
          salaryPeriod: data.get("salaryPeriod"),
          description: data.get("description"),
          requirements: String(data.get("requirements") ?? "")
            .split("\n")
            .map((requirement) => requirement.trim())
            .filter(Boolean),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "We couldn't publish this role.";
      if (!response.ok) {
        setError(message);
        return;
      }
      setSuccess("Your role is now live in the CareerVerse job catalog.");
      form.reset();
      setOtherCountry(false);
      router.refresh();
    } catch {
      setError("Employer tools could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="employer-job-form" onSubmit={submit}>
      <fieldset className="employer-form-section">
        <legend><span>01</span> Role essentials</legend>
        <p className="employer-form-section-hint">Start with the details candidates use to discover your role.</p>
        <label>Job title<input name="title" minLength={3} maxLength={160} required /></label>
        <label>Company name<input name="company" maxLength={160} required /></label>
        <label>Location<input name="location" maxLength={180} placeholder="City, region, or Remote" required /></label>
        <label>Country / region
          <select
            name="countryCode"
            defaultValue=""
            required
            onChange={(event) => setOtherCountry(event.target.value === "OTHER")}
          >
            <option value="" disabled>Select a country (dial code shown)</option>
            {jobCountries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name} ({country.callingCode})
              </option>
            ))}
            <option value="OTHER">Other (enter ISO country code)</option>
          </select>
          {otherCountry && (
            <input
              aria-label="Two-letter ISO country code"
              name="countryCodeManual"
              pattern="[A-Za-z]{2}"
              maxLength={2}
              placeholder="e.g. SG"
              required
            />
          )}
          <small>Choose the country for this role. Its international calling code is shown for reference.</small>
        </label>
        <label>Employment type
          <select name="employmentType" defaultValue="full_time">
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
            <option value="temporary">Temporary</option>
          </select>
        </label>
        <label>Work style
          <select name="workplaceType" defaultValue="onsite">
            <option value="onsite">On-site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
          </select>
        </label>
      </fieldset>
      <fieldset className="employer-form-section">
        <legend><span>02</span> Experience and compensation</legend>
        <p className="employer-form-section-hint">Set expectations up front. Compensation details are optional.</p>
        <label>Experience<input name="experience" maxLength={120} placeholder="e.g. 2–5 years or Entry level" /></label>
        <label>Minimum compensation<input name="salaryMin" type="number" min="0" max="99999999999.99" step="0.01" placeholder="Optional" /></label>
        <label>Maximum compensation<input name="salaryMax" type="number" min="0" max="99999999999.99" step="0.01" placeholder="Optional" /></label>
        <label>Salary currency<input name="salaryCurrency" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" placeholder="Optional, e.g. USD" /></label>
        <label>Pay period<select name="salaryPeriod" defaultValue=""><option value="">Not provided</option><option value="hour">Per hour</option><option value="month">Per month</option><option value="year">Per year</option></select></label>
        <label className="employer-job-form-wide">Additional compensation details<input name="salary" maxLength={160} placeholder="Benefits, bonus, equity, or pay transparency note" /></label>
      </fieldset>
      <fieldset className="employer-form-section employer-form-section-wide">
        <legend><span>03</span> Role description</legend>
        <p className="employer-form-section-hint">Help candidates understand the opportunity and what they will bring to it.</p>
        <label className="employer-job-form-wide">Description<textarea name="description" minLength={30} maxLength={20000} rows={6} required /></label>
        <label className="employer-job-form-wide">Requirements <small>Enter one requirement per line.</small><textarea name="requirements" maxLength={16000} rows={5} required /></label>
      </fieldset>
      {error && <p className="account-form-error employer-job-form-wide" role="alert">{error}</p>}
      {success && <p className="employer-job-form-success employer-job-form-wide" role="status">{success}</p>}
      <div className="employer-form-submit employer-job-form-wide">
        <p>Your listing will be visible in the job catalog after it is published.</p>
        <button className="btn btn-violet" disabled={busy}>{busy ? "Publishing…" : "Publish role"} <span aria-hidden="true">→</span></button>
      </div>
    </form>
  );
}