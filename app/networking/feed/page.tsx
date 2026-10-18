import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeedWorkspace } from "@/components/NetworkingWorkspace";
import NetworkingNavigation from "@/components/NetworkingNavigation";
import { getCurrentAccount } from "@/lib/auth";

export const metadata: Metadata = { title: "Career feed" };
export const dynamic = "force-dynamic";

export default async function CareerFeedPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  return <main className="jobs-page networking-experience">
    <NetworkingNavigation />
    <div className="wrap network-page">
    <div className="crumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><b>Career feed</b></div>
    <FeedWorkspace accountId={account.id} accountName={account.fullName} />
    </div>
  </main>;
}
