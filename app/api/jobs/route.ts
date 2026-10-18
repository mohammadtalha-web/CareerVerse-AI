import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";
import { searchJobs } from "@/lib/job-repository";
import { recordJobSearch } from "@/lib/notifications";

export const dynamic = "force-dynamic";

function first(params: URLSearchParams, key: string): string | undefined {
  return params.get(key) ?? undefined;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? "1");
  try {
    const result = await searchJobs({
      query: first(params, "q"),
      location: first(params, "location"),
      country: first(params, "country"),
      employmentType: first(params, "employmentType"),
      workplaceType: first(params, "workplaceType"),
      sourceType: first(params, "sourceType"),
      page,
    });
    const account = await getCurrentAccount();
    if (account) {
      await recordJobSearch(account.id, params.get("q") ?? "", params.get("location") ?? "")
        .catch((error: unknown) => console.error("Recording a member job search failed.", error));
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": result.mode === "live" ? "public, max-age=60" : "no-store" },
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("The job catalog is unavailable. Apply the database schema and check the database connection.", 503);
    }
    if (error instanceof Error && /invalid|out of range/i.test(error.message)) {
      return jsonError(error.message, 400);
    }
    console.error("Job search failed.", error);
    return jsonError("We couldn't search jobs right now.", 500);
  }
}