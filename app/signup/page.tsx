import type { Metadata } from "next";
import AccountForm from "@/components/AccountForm";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return <AccountForm mode="signup" />;
}