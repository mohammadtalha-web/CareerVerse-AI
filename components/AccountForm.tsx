"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type AccountFormProps = { mode: "login" | "signup"; initialError?: string };

function isAdminAccountResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("account" in value)) return false;
  const account = value.account;
  return typeof account === "object" && account !== null &&
    "role" in account && account.role === "admin";
}

function isPendingVerificationResponse(
  value: unknown,
): value is { verificationRequired: true; email: string; resendAfterSeconds: number } {
  if (typeof value !== "object" || value === null) return false;
  return "verificationRequired" in value && value.verificationRequired === true &&
    "email" in value && typeof value.email === "string" &&
    "resendAfterSeconds" in value && typeof value.resendAfterSeconds === "number";
}

function isVerifiedSignupResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("account" in value)) return false;
  const account = value.account;
  return "verified" in value && value.verified === true &&
    typeof account === "object" && account !== null && "role" in account &&
    (account.role === "job_seeker" || account.role === "recruiter");
}

export default function AccountForm({ mode, initialError = "" }: AccountFormProps) {
  const router = useRouter();
  const signup = mode === "signup";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [accountConflict, setAccountConflict] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (resendSeconds === 0) return;
    const timer = window.setTimeout(() => {
      setResendSeconds((seconds) => Math.max(seconds - 1, 0));
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (signup && data.get("password") !== data.get("confirmPassword")) {
      setError("Passwords do not match.");
      const confirmation = form.elements.namedItem("confirmPassword");
      if (confirmation instanceof HTMLInputElement) confirmation.focus();
      return;
    }
    if (!form.reportValidity()) return;
    setBusy(true);
    setError("");
    setAccountConflict(false);
    try {
      const response = await fetch(`/api/auth/${signup ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
          ...(signup
            ? {
                confirmPassword: data.get("confirmPassword"),
                fullName: data.get("fullName"),
                role: data.get("role"),
                university: data.get("university"),
              }
            : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (signup && response.status === 409) {
          setError("This email is already in use or has a signup waiting for verification.");
          setAccountConflict(true);
          return;
        }
        const message =
          typeof payload === "object" && payload !== null && "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "We couldn't complete your request. Please try again.";
        setError(message);
        return;
      }
      if (signup) {
        if (!isPendingVerificationResponse(payload)) {
          setError("We couldn't start email verification. Please try again.");
          return;
        }
        setPendingEmail(payload.email);
        setVerificationCode("");
        setResendSeconds(payload.resendAfterSeconds);
        setVerificationPending(true);
        return;
      }
      router.replace(isAdminAccountResponse(payload) ? "/admin" : "/networking/feed");
      router.refresh();
    } catch {
      setError("Account services could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifySignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail, code: verificationCode }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" && payload !== null && "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "We couldn't verify your email. Please try again.";
        setError(message);
        return;
      }
      if (!isVerifiedSignupResponse(payload)) {
        setError("Your email verification response was incomplete. Please log in or contact support.");
        return;
      }
      router.replace("/networking/feed");
      router.refresh();
    } catch {
      setError("Account services could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/register/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" && payload !== null && "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "We couldn't resend your verification code. Please try again.";
        setError(message);
        if (
          typeof payload === "object" && payload !== null &&
          "retryAfterSeconds" in payload && typeof payload.retryAfterSeconds === "number"
        ) {
          setResendSeconds(payload.retryAfterSeconds);
        }
        return;
      }
      if (
        typeof payload !== "object" || payload === null ||
        !("sent" in payload) || payload.sent !== true ||
        !("resendAfterSeconds" in payload) || typeof payload.resendAfterSeconds !== "number"
      ) {
        setError("We couldn't confirm that a new code was sent. Please try again.");
        return;
      }
      setVerificationCode("");
      setResendSeconds(payload.resendAfterSeconds);
    } catch {
      setError("Account services could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="jobs-page">
      <div className="wrap account-form-wrap">
        <section className="card card-pad account-form-card" aria-labelledby="account-title">
          <span className="section-kicker">{signup ? "GET STARTED" : "WELCOME BACK"}</span>
          <h1 id="account-title">{signup ? "Create your CareerVerse account" : "Log in to CareerVerse"}</h1>
          <p>{signup ? "Create an account to save roles and manage your applications." : "Sign in to continue to your career workspace."}</p>
          {error && (
            <p className="account-form-error" role="alert">
              {error}
              {accountConflict && <> <Link href="/login">Log in</Link> if you already have an account, or use a different email. If you recently requested a code, check your inbox.</>}
            </p>
          )}
          {(!signup || !verificationPending) && (
            <>
              <a className="google-signin-button" href="/api/auth/google">
                <svg aria-hidden="true" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.91c-.58 2.96-2.26 5.48-4.72 7.18l7.64 5.93c4.46-4.12 7.15-10.18 7.15-17.58Z" />
                  <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19Z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.87l-7.64-5.93c-2.13 1.43-4.86 2.28-8.26 2.28-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
                </svg>
                {signup ? "Sign up with Google" : "Continue with Google"}
              </a>
              <p className="google-signin-note">
                {signup
                  ? "Google sign-up creates a job seeker account. To register as a recruiter, use email."
                  : "New Google sign-ins create a job seeker account."}
              </p>
              <div className="account-form-divider"><span>or continue with email</span></div>
            </>
          )}
          {signup && verificationPending && (
            <section className="account-email-verification" aria-labelledby="verification-title">
              <h2 id="verification-title">Check your email</h2>
              <p>We sent a six-digit verification code to <strong>{pendingEmail}</strong>. It expires in 10 minutes.</p>
              <form className="account-form" onSubmit={verifySignup}>
                <label>Email verification code
                  <input
                    name="verificationCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                  />
                </label>
                <small>You can try up to five codes before requesting a new one.</small>
                <button className="btn btn-violet" type="submit" disabled={busy}>
                  {busy ? "Please wait…" : "Verify email and create account"}
                </button>
              </form>
              <button className="account-verification-resend" type="button" onClick={resendCode} disabled={busy || resendSeconds > 0}>
                {resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Resend verification code"}
              </button>
              <button
                className="account-verification-edit"
                type="button"
                onClick={() => {
                  setVerificationPending(false);
                  setVerificationCode("");
                  setError("");
                }}
              >
                Use a different email or edit details
              </button>
            </section>
          )}
          <form className="account-form" onSubmit={submit} hidden={signup && verificationPending}>
            {signup && (
              <>
                <label>Full name<input name="fullName" autoComplete="name" minLength={2} maxLength={100} required /></label>
                <label>Account type
                  <select name="role" defaultValue="job_seeker">
                    <option value="job_seeker">Job seeker</option>
                    <option value="recruiter">Recruiter</option>
                  </select>
                </label>
                <label>University (optional)
                  <input name="university" autoComplete="organization" maxLength={160} />
                </label>
                <small>Add your university to appear in CareerVerse Academic Communities. This is self-reported and can be left blank.</small>
              </>
            )}
            <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
            <label>Password
              <span className="account-password-input">
                <input id="account-password" aria-label="Password" name="password" type={showPassword ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 12 : undefined} maxLength={128} required />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-controls="account-password" aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? "Hide" : "Show"}</button>
              </span>
            </label>
            {signup && (
              <>
                <label>Confirm password
                  <span className="account-password-input">
                    <input id="account-confirm-password" aria-label="Confirm password" name="confirmPassword" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={128} required />
                    <button type="button" aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} aria-controls="account-confirm-password" aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((shown) => !shown)}>{showConfirmPassword ? "Hide" : "Show"}</button>
                  </span>
                </label>
                <small>Use at least 12 characters. Recruiter accounts require independent verification before posting jobs.</small>
              </>
            )}
            <button className="btn btn-violet" type="submit" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Log in"}</button>
          </form>
          <p className="account-form-switch">
            {signup ? "Already have an account?" : "New to CareerVerse?"}{" "}
            <Link href={signup ? "/login" : "/signup"}>{signup ? "Log in" : "Create an account"}</Link>
          </p>
        </section>
      </div>
    </main>
  );
}