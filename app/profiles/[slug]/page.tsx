import type { Metadata } from "next";
import Link from "next/link";
import { PublicProfile } from "@/components/NetworkingWorkspace";
import NetworkingNavigation from "@/components/NetworkingNavigation";
import { getCurrentAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug} — Professional profile` };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const account = await getCurrentAccount();
  return <main className="jobs-page networking-experience">
    <NetworkingNavigation />
    <div className="wrap network-page">
    <div className="crumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><b>Professional profile</b></div>
    <PublicProfile slug={slug} isSignedIn={Boolean(account)} />
    </div>
  </main>;
}
