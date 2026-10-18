import type { Metadata } from "next";
import Link from "next/link";
import UniversityNetwork from "@/components/UniversityNetwork";

export const metadata: Metadata = {
  title: "Academic Communities",
  description: "Explore academic communities represented by CareerVerse members.",
};

export default function UniversityPortalPage() {
  return (
    <main className="jobs-page university-page">
      <div className="wrap">
        <div className="crumbs"><Link href="/">Home</Link><span aria-hidden="true">/</span><b>Academic Communities</b></div>
        <UniversityNetwork />
      </div>
    </main>
  );
}
