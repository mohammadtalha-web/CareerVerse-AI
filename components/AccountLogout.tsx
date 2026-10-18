"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountLogout() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        setError("We couldn't end your session. Please try again.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Account services could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn btn-line" type="button" onClick={() => void logout()} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && <p role="alert" className="account-form-error">{error}</p>}
    </div>
  );
}