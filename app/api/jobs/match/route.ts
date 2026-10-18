import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { AiProviderError, aiProviderUnavailableMessage, checkAiProviderStatus, getConfiguredAiProvider, requestAiCompletion } from "@/lib/ai-provider";
import { consumeAiUserQuota } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

type JobRow = RowDataPacket & {
  slug: string;
  title: string;
  company_name: string;
  country_code: string;
  location: string;
  employment_type: string;
  workplace_type: string;
  description: string;
};

type ModelMatch = { slug: string; score: number; reasons: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseMatches(content: unknown, permittedSlugs: Set<string>): ModelMatch[] {
  let payload: unknown;
  try {
    payload = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    throw new Error("The AI provider returned invalid JSON.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.matches)) {
    throw new Error("The AI provider returned an invalid matches structure.");
  }
  const seen = new Set<string>();
  const matches: ModelMatch[] = [];
  for (const candidate of payload.matches) {
    if (!isRecord(candidate)) continue;
    const { slug, score, reasons } = candidate;
    if (
      typeof slug !== "string" ||
      !permittedSlugs.has(slug) ||
      seen.has(slug) ||
      !Number.isInteger(score) ||
      typeof score !== "number" ||
      score < 0 ||
      score > 100 ||
      !Array.isArray(reasons)
    ) {
      continue;
    }
    const safeReasons = reasons
      .filter((reason): reason is string => typeof reason === "string")
      .map((reason) => reason.trim().slice(0, 180))
      .filter(Boolean)
      .slice(0, 3);
    if (safeReasons.length === 0) continue;
    seen.add(slug);
    matches.push({ slug, score, reasons: safeReasons });
  }
  return matches.sort((left, right) => right.score - left.score);
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > 16_384) return jsonError("The request is too large.", 413);

  let text: string;
  try {
    text = await request.text();
  } catch {
    return jsonError("The request body could not be read.", 400);
  }
  if (Buffer.byteLength(text, "utf8") > 16_384) return jsonError("The request is too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }
  if (!isRecord(body)) return jsonError("Matching preferences are required.", 400);

  const slugs = Array.isArray(body.slugs)
    ? body.slugs.filter((slug): slug is string => typeof slug === "string")
    : [];
  const skills = typeof body.skills === "string" ? body.skills.trim() : "";
  const targetTitles = typeof body.targetTitles === "string" ? body.targetTitles.trim() : "";
  const country = typeof body.country === "string" ? body.country.trim().toUpperCase() : "";
  if (
    body.consent !== true ||
    slugs.length < 1 ||
    slugs.length > 20 ||
    new Set(slugs).size !== slugs.length ||
    slugs.some((slug) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) ||
    !skills ||
    skills.length > 1_000 ||
    !targetTitles ||
    targetTitles.length > 300 ||
    !/^[A-Z]{2}$/.test(country)
  ) {
    return jsonError("Provide valid matching preferences and consent.", 400);
  }

  let account;
  try {
    account = await getCurrentAccount();
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Matching requires the configured account database.", 503);
    console.error("Unable to verify the matching request account.", error);
    return jsonError("We couldn't verify your account.", 500);
  }
  if (!account) return jsonError("Sign in to request personalized job matching.", 401);
  if (account.role !== "job_seeker") {
    return jsonError("Personalized job matching is available for job seeker accounts.", 403);
  }

  let provider;
  try {
    provider = getConfiguredAiProvider();
  } catch (error) {
    console.error("Invalid local AI provider configuration.", error);
    return jsonError("The local AI model configuration is invalid.", 503);
  }

  try {
    const placeholders = slugs.map(() => "?").join(", ");
    const [rows] = await getDatabase().execute<JobRow[]>(
      `SELECT slug, title, company_name, country_code, location,
              employment_type, workplace_type, description
       FROM jobs j
       WHERE j.slug IN (${placeholders})
         AND j.status = 'published' AND j.moderation_hidden = FALSE
         AND j.is_sample = FALSE
         AND (j.expires_at IS NULL OR j.expires_at > CURRENT_TIMESTAMP)
         AND (j.source_id IS NULL OR EXISTS (
           SELECT 1 FROM job_sources s
           WHERE s.id = j.source_id AND s.verified = TRUE AND s.enabled = TRUE
         ))
         AND (j.employer_id IS NULL OR EXISTS (
           SELECT 1 FROM users u
           WHERE u.id = j.employer_id AND u.role = 'recruiter' AND u.recruiter_verified = TRUE
         ))`,
      slugs,
    );
    if (!rows.length) return jsonError("No live listings are available to match.", 404);
    const providerStatus = await checkAiProviderStatus(provider);
    if (providerStatus !== "ready") {
      return jsonError(aiProviderUnavailableMessage(providerStatus, provider.model), 503);
    }
    if (!(await consumeAiUserQuota(account.id))) {
      return jsonError("You have reached the limit of 20 AI requests per hour. Please try again later.", 429);
    }

    const content = await requestAiCompletion(
      provider,
      [
          {
            role: "system",
            content:
              "Rank only the supplied jobs against the candidate's stated skills, target titles, and country. Do not infer protected characteristics. Return JSON only in the form {\"matches\":[{\"slug\":\"...\",\"score\":0,\"reasons\":[\"...\",\"...\"]}]}. Each score MUST be an integer from 0 to 100, never a decimal or a 0-to-1 fraction. Scores are approximate relevance suggestions, not hiring decisions. Give specific, concise reasons grounded in supplied data.",
          },
          {
            role: "user",
            content: JSON.stringify({
              candidate: { skills, targetTitles, country },
              jobs: rows.map((job) => ({
                slug: job.slug,
                title: job.title,
                company: job.company_name,
                country: job.country_code,
                location: job.location,
                employmentType: job.employment_type,
                workplaceType: job.workplace_type,
                description: job.description.slice(0, 4_000),
              })),
            }),
          },
        ],
      { temperature: 0, responseFormat: "json_object", maxTokens: 300, timeoutMs: 60_000 },
    );
    const matches = parseMatches(content, new Set(rows.map((job) => job.slug)));
    if (!matches.length) return jsonError("The AI service could not rank these listings.", 502);
    return NextResponse.json({ matches, model: provider.model });
  } catch (error) {
    if (error instanceof AiProviderError) return jsonError(error.message, error.status);
    if (isDatabaseUnavailable(error)) {
      return jsonError("Matching is unavailable. Check that the database schema is installed.", 503);
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return jsonError("AI matching timed out. Please try again.", 504);
    }
    console.error("Job matching failed.", error);
    return jsonError("AI matching could not be completed. Please try again.", 502);
  }
}
