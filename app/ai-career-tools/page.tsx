import type { Metadata } from "next";
import AiCareerTools from "@/components/AiCareerTools";

export const metadata: Metadata = {
  title: "AI Career Tools",
  description: "Use real AI assistance for career coaching, resumes, interviews, skills, and career planning.",
};

export default function AiCareerToolsPage() {
  return <AiCareerTools />;
}
