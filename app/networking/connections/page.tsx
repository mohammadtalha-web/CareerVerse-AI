import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConnectionsWorkspace, FeedWorkspace } from "@/components/NetworkingWorkspace";
import NetworkingNavigation from "@/components/NetworkingNavigation";
import { getCurrentAccount } from "@/lib/auth";

export const metadata: Metadata = { title: "Connections" };
export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  return <main className="jobs-page networking-experience networking-connections-experience">
    <NetworkingNavigation />
    <div className="wrap network-page">
    <div className="crumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><b>Connections</b></div>
    <div className="network-connections-dashboard">
      <FeedWorkspace accountId={account.id} accountName={account.fullName} scope="connections" />
      <aside className="network-connections-sidebar" aria-label="Your professional network">
        <ConnectionsWorkspace />
      </aside>
    </div>
    </div>
  </main>;
}
