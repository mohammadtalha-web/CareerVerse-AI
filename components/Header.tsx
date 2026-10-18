"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import NotificationBell from "@/components/NotificationBell";

const navigation = [
  { href: "/jobs", label: "Find jobs" },
  { href: "/networking/feed", label: "Network" },
  { href: "/companies", label: "Companies" },
  { href: "/ai-career-tools", label: "AI career tools" },
  { href: "/employer/jobs", label: "For employers" },
  { href: "/university-portal", label: "Academic Communities" },
];

type SessionAccount = {
  fullName: string;
  role: "job_seeker" | "recruiter" | "admin";
};

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; account: SessionAccount }
  | { status: "error"; message: string };

function readSessionAccount(value: unknown): SessionAccount | null {
  if (typeof value !== "object" || value === null || !("account" in value)) return null;
  const account = value.account;
  if (typeof account !== "object" || account === null || !("role" in account) || !("fullName" in account)) {
    return null;
  }
  const role = account.role;
  const fullName = account.fullName;
  if (
    (role !== "job_seeker" && role !== "recruiter" && role !== "admin") ||
    typeof fullName !== "string"
  ) {
    return null;
  }
  return { fullName, role };
}

async function getSessionState(signal?: AbortSignal): Promise<SessionState> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store", signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof payload === "object" && payload !== null && "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "We couldn't check your sign-in status.";
      return { status: "error", message };
    }
    const account = readSessionAccount(payload);
    return account ? { status: "signed-in", account } : { status: "signed-out" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "loading" };
    }
    return {
      status: "error",
      message: error instanceof Error ? error.message : "We couldn't check your sign-in status.",
    };
  }
}

function AuthActions({
  session,
  mobile = false,
  checkingSession,
  signingOut,
  signOutError,
  workspaceHref,
  workspaceLabel,
  onCheckSession,
  onSignOut,
  onNavigate,
}: {
  session: SessionState;
  mobile?: boolean;
  checkingSession: boolean;
  signingOut: boolean;
  signOutError: string;
  workspaceHref: string;
  workspaceLabel: string;
  onCheckSession: () => void;
  onSignOut: () => void;
  onNavigate: () => void;
}) {
  const className = mobile ? "mobile-auth-actions" : "navcta";
  if (session.status === "loading") {
    return <div className={`${className} nav-auth-loading`} role="status">Checking account…</div>;
  }
  if (session.status === "error") {
    return (
      <div className={`${className} nav-auth-error`} role="alert">
        <span>{session.message}</span>
        <button type="button" className="nav-login" onClick={onCheckSession} disabled={checkingSession}>
          {checkingSession ? "Checking…" : "Retry"}
        </button>
      </div>
    );
  }
  if (session.status === "signed-in") {
    return (
      <div className={`${className} nav-account-actions`}>
        <Link href={workspaceHref} className="nav-login" onClick={onNavigate}>{workspaceLabel}</Link>
        <button type="button" className="btn btn-line nav-signout" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        {signOutError && <span className="nav-signout-error" role="alert">{signOutError}</span>}
      </div>
    );
  }
  return (
    <div className={`${className} nav-guest-actions`}>
      <Link href="/login" className={mobile ? "btn btn-line" : "nav-login"} onClick={onNavigate}>Log in</Link>
      <Link href="/signup" className={`btn btn-violet${mobile ? "" : " nav-signup"}`} onClick={onNavigate}>Create account <span aria-hidden="true">→</span></Link>
    </div>
  );
}

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [checkingSession, setCheckingSession] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  const checkSession = useCallback(async (signal?: AbortSignal) => {
    setCheckingSession(true);
    const nextSession = await getSessionState(signal);
    if (!signal?.aborted) setSession(nextSession);
    setCheckingSession(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadSession() {
      const nextSession = await getSessionState(controller.signal);
      if (!controller.signal.aborted) setSession(nextSession);
    }
    void loadSession();
    return () => controller.abort();
  }, [pathname]);

  useEffect(() => {
    const theme = session.status === "signed-in"
      ? session.account.role === "job_seeker"
        ? "job-seeker"
        : session.account.role
      : "public";
    document.documentElement.dataset.theme = theme;
  }, [session]);

  useEffect(() => {
    const refreshSession = () => void checkSession();
    window.addEventListener("focus", refreshSession);
    return () => window.removeEventListener("focus", refreshSession);
  }, [checkSession]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === "object" && payload !== null && "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "We couldn't end your session. Please try again.";
        throw new Error(message);
      }
      setSession({ status: "signed-out" });
      setMenuOpen(false);
      router.replace("/");
      router.refresh();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : "We couldn't end your session. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  const workspaceHref = session.status === "signed-in" && session.account.role === "admin"
    ? "/admin"
    : "/account";
  const workspaceLabel = session.status === "signed-in" && session.account.role === "admin"
    ? "Admin workspace"
    : "My workspace";

  const actionProps = {
    session,
    checkingSession,
    signingOut,
    signOutError,
    workspaceHref,
    workspaceLabel,
    onCheckSession: () => void checkSession(),
    onSignOut: () => void signOut(),
    onNavigate: () => setMenuOpen(false),
  };

  return (
    <header className="site-header">
      <nav className="wrap site-nav" aria-label="Main navigation">
        <Link href="/" className="logo site-logo" aria-label="CareerVerse AI home" onClick={() => setMenuOpen(false)}>
          <span className="mark">C</span><span>CareerVerse<span className="logo-accent">.</span></span>
        </Link>
        <div id="site-navigation" className={`navlinks${menuOpen ? " navlinks-open" : ""}`}>
          {navigation
            .filter((item) =>
              session.status !== "signed-in" ||
              session.account.role !== "recruiter" ||
              (item.href !== "/jobs" && item.href !== "/university-portal"),
            )
            .map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "page" : undefined} onClick={() => setMenuOpen(false)}>
              {item.label}
            </Link>
            ))}
          <AuthActions {...actionProps} mobile />
        </div>
        <NotificationBell enabled={session.status === "signed-in"} />
        <AuthActions {...actionProps} />
        <button
          className={`menu-toggle${menuOpen ? " menu-toggle-open" : ""}`}
          type="button"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="site-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span /><span />
        </button>
      </nav>
    </header>
  );
}
