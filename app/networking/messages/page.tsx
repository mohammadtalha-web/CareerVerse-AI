import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessagesWorkspace } from "@/components/NetworkingWorkspace";
import NetworkingNavigation from "@/components/NetworkingNavigation";
import { getCurrentAccount } from "@/lib/auth";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  return <main className="jobs-page networking-experience">
    <NetworkingNavigation />
    <div className="wrap network-page">
    <div className="crumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><b>Messages</b></div>
    <MessagesWorkspace />
    </div>
  </main>;
}
