import type { Metadata } from "next";
import AccountForm from "@/components/AccountForm";

export const metadata: Metadata = { title: "Log in" };

const googleSignInErrors: Record<string, string> = {
  google_not_configured: "Google sign-in is not configured yet. Add the Google OAuth credentials and redirect URI to the server environment.",
  google_cancelled: "Google sign-in was cancelled.",
  google_invalid: "Google sign-in could not be verified. Please try again.",
  google_email_exists: "This Google account could not be connected to your CareerVerse account. Sign in using the Google account or email address originally linked to it.",
  google_setup_required: "Google sign-in needs a database update. Apply the latest auth migration, then try again.",
  google_failed: "Google sign-in could not be completed. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? googleSignInErrors[params.error] : undefined;
  return <AccountForm mode="login" initialError={error} />;
}