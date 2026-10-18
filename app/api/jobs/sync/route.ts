import { timingSafeEqual, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";
import { getSourceConfigurations, isSafePublicHttpsUrl } from "@/lib/job-sources";
import { notifyMembersAboutJob } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_FEED_BYTES = 1_000_000;
const MAX_JOBS_PER_FEED = 250;

type SourceRow = RowDataPacket & {
  id: number;
  sourceKey: string;
  name: string;
  countryCode: string;
  sourceType: "government" | "private";
  websiteUrl: string;
};

type FeedJob = {
  externalId: string;
  title: string;
  companyName: string;
  location: string;
  employmentType: "full_time" | "part_time" | "contract" | "internship" | "temporary";
  workplaceType: "onsite" | "hybrid" | "remote";
  experience: string;
  salary: string;
  description: string;
  requirements: string[];
  applicationUrl: string;
  sourceUrl: string;
  expiresAt: Date | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function constantTimeSecretMatch(expected: string, received: string | null): boolean {
  if (!received || received.length > 512) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const receivedDigest = createHash("sha256").update(received).digest();
  return timingSafeEqual(expectedDigest, receivedDigest) && expected === received;
}

function parseFeedJob(value: unknown): FeedJob | null {
  if (!isRecord(value)) return null;
  const {
    externalId,
    title,
    companyName,
    location,
    employmentType,
    workplaceType,
    experience,
    salary,
    description,
    requirements,
    applicationUrl,
    sourceUrl,
    expiresAt,
  } = value;

  if (
    typeof externalId !== "string" ||
    !externalId.trim() ||
    externalId.length > 200 ||
    typeof title !== "string" ||
    title.trim().length < 3 ||
    title.length > 160 ||
    typeof companyName !== "string" ||
    !companyName.trim() ||
    companyName.length > 160 ||
    typeof location !== "string" ||
    location.length > 180 ||
    !["full_time", "part_time", "contract", "internship", "temporary"].includes(String(employmentType)) ||
    !["onsite", "hybrid", "remote"].includes(String(workplaceType)) ||
    typeof description !== "string" ||
    !description.trim() ||
    description.length > 20_000 ||
    !Array.isArray(requirements) ||
    requirements.length > 30 ||
    requirements.some((item) => typeof item !== "string" || item.length > 500) ||
    !isSafePublicHttpsUrl(applicationUrl) ||
    !isSafePublicHttpsUrl(sourceUrl) ||
    (experience !== undefined && (typeof experience !== "string" || experience.length > 120)) ||
    (salary !== undefined && (typeof salary !== "string" || salary.length > 160)) ||
    (expiresAt !== undefined && (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))))
  ) {
    return null;
  }
  const expiresDate = typeof expiresAt === "string" ? new Date(expiresAt) : null;
  if (expiresDate && expiresDate.getTime() <= Date.now()) return null;

  return {
    externalId: externalId.trim(),
    title: title.trim(),
    companyName: companyName.trim(),
    location: location.trim(),
    employmentType: employmentType as FeedJob["employmentType"],
    workplaceType: workplaceType as FeedJob["workplaceType"],
    experience: typeof experience === "string" ? experience.trim() : "",
    salary: typeof salary === "string" ? salary.trim() : "",
    description: description.trim(),
    requirements: requirements.map((item) => (item as string).trim()),
    applicationUrl,
    sourceUrl,
    expiresAt: expiresDate,
  };
}

async function fetchFeed(
  url: URL,
  apiKey?: string,
): Promise<FeedJob[]> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new Error("Feed did not return a JSON content type.");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_FEED_BYTES) throw new Error("Feed response is larger than the allowed size.");
  if (!response.body) throw new Error("Feed response has no readable body.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error("Feed response is larger than the allowed size.");
    }
    chunks.push(value);
  }

  let payload: unknown;
  try {
    const bytes = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Feed did not return valid JSON.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.jobs) || payload.jobs.length > MAX_JOBS_PER_FEED) {
    throw new Error("Feed must contain a jobs array with at most 250 records.");
  }
  const parsed = payload.jobs.map(parseFeedJob);
  if (parsed.some((job) => job === null)) {
    throw new Error("Feed contains invalid, unsafe, or expired job records.");
  }
  return parsed as FeedJob[];
}

function stableSlug(sourceKey: string, externalId: string): string {
  const digest = createHash("sha256").update(`${sourceKey}:${externalId}`).digest("hex").slice(0, 20);
  return `${sourceKey}-${digest}`;
}

export async function POST(request: Request) {
  const secret = process.env.JOB_SOURCE_SYNC_SECRET;
  if (!secret || !constantTimeSecretMatch(secret, request.headers.get("x-job-sync-secret"))) {
    return jsonError("Job source synchronization is not authorized.", 401);
  }

  let configurations;
  try {
    configurations = getSourceConfigurations();
  } catch (error) {
    console.error("Job source configuration is invalid.", error);
    return jsonError("Job source configuration is invalid. Check the server environment settings.", 503);
  }
  if (!configurations.size) return jsonError("No job source feeds are configured.", 503);

  try {
    const pool = getDatabase();
    const [sources] = await pool.execute<SourceRow[]>(
      `SELECT id, source_key AS sourceKey, name, country_code AS countryCode,
              source_type AS sourceType, website_url AS websiteUrl
       FROM job_sources WHERE verified = TRUE AND enabled = TRUE`,
    );
    let imported = 0;
    let closed = 0;
    const failures: string[] = [];

    for (const source of sources) {
      const configuration = configurations.get(source.sourceKey);
      if (!configuration) continue;
      const syncStarted = new Date();
      try {
        const apiKey = configuration.apiKeyEnv
          ? process.env[configuration.apiKeyEnv]
          : undefined;
        const feedJobs = await fetchFeed(configuration.feedUrl, apiKey);
        const officialHost = new URL(source.websiteUrl).hostname.toLowerCase();
        if (
          feedJobs.some((job) => {
            const sourceHost = new URL(job.sourceUrl).hostname.toLowerCase();
            return sourceHost !== officialHost && !sourceHost.endsWith(`.${officialHost}`);
          })
        ) {
          throw new Error("Feed job source URL does not match the verified portal domain.");
        }
        for (const job of feedJobs) {
          const slug = stableSlug(source.sourceKey, job.externalId);
          const [insertResult] = await pool.execute(
            `INSERT INTO jobs (
              source_id, external_id, slug, title, company_name, location,
              country_code, employment_type, workplace_type, experience,
              salary, description, requirements, application_url, source_url,
              status, is_sample, published_at, expires_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', FALSE, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              title = VALUES(title),
              company_name = VALUES(company_name),
              location = VALUES(location),
              country_code = VALUES(country_code),
              employment_type = VALUES(employment_type),
              workplace_type = VALUES(workplace_type),
              experience = VALUES(experience),
              salary = VALUES(salary),
              description = VALUES(description),
              requirements = VALUES(requirements),
              application_url = VALUES(application_url),
              source_url = VALUES(source_url),
              status = 'published',
              expires_at = VALUES(expires_at),
              last_seen_at = VALUES(last_seen_at)`,
            [
              source.id,
              job.externalId,
              slug,
              job.title,
              job.companyName,
              job.location,
              source.countryCode,
              job.employmentType,
              job.workplaceType,
              job.experience,
              job.salary,
              job.description,
              JSON.stringify(job.requirements),
              job.applicationUrl,
              job.sourceUrl,
              syncStarted,
              job.expiresAt,
              syncStarted,
            ],
          );
          if (Number((insertResult as { affectedRows?: number }).affectedRows) === 1) {
            const [jobRows] = await pool.execute<RowDataPacket[]>(
              "SELECT id FROM jobs WHERE source_id = ? AND external_id = ? LIMIT 1",
              [source.id, job.externalId],
            );
            if (jobRows[0]) await notifyMembersAboutJob(Number(jobRows[0].id));
          }
          imported += 1;
        }
        const [closeResult] = await pool.execute(
          `UPDATE jobs SET status = 'closed'
           WHERE source_id = ? AND status = 'published'
             AND (last_seen_at IS NULL OR last_seen_at < ?)`,
          [source.id, syncStarted],
        );
        closed += Number((closeResult as { affectedRows?: number }).affectedRows ?? 0);
        await pool.execute(
          "UPDATE job_sources SET last_synced_at = ? WHERE id = ?",
          [new Date(), source.id],
        );
      } catch (error) {
        console.error(`Job source sync failed for ${source.sourceKey}.`, error);
        failures.push(source.sourceKey);
      }
    }

    if (!sources.length) {
      return jsonError("No verified and enabled job sources are available to sync.", 409);
    }
    const response = { imported, closed, failedSources: failures };
    return NextResponse.json(response, { status: failures.length ? 207 : 200 });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Job source synchronization requires the configured MySQL schema.", 503);
    }
    console.error("Job source synchronization failed.", error);
    return jsonError("Job source synchronization could not be completed.", 500);
  }
}
