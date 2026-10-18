import "server-only";

import type { RowDataPacket } from "mysql2";
import { careerJobs, type CareerJob } from "@/lib/jobs";
import { getDatabase } from "@/lib/db";
import { booleanPrefixSearch } from "@/lib/search";

export type JobFilters = {
  query?: string;
  location?: string;
  country?: string;
  employmentType?: string;
  workplaceType?: string;
  sourceType?: string;
  page?: number;
  pageSize?: number;
};

export type JobSearchPage = {
  jobs: CareerJob[];
  total: number;
  page: number;
  pageSize: number;
  mode: "live" | "demo";
};

type JobRow = RowDataPacket & {
  id: number;
  slug: string;
  title: string;
  companyName: string;
  location: string;
  countryCode: string;
  employmentType: "full_time" | "part_time" | "contract" | "internship" | "temporary";
  workplaceType: "onsite" | "hybrid" | "remote";
  experience: string | null;
  salary: string;
  description: string;
  requirements: unknown;
  applicationUrl: string | null;
  sourceUrl: string | null;
  sourceName: string;
  sourceType: "government" | "private";
  isSample: number;
  sourceId: number | null;
  publishedAt: Date | string | null;
};

const PAGE_SIZE = 12;
const MAX_PAGE = 10_000;
const EMPLOYMENT_TYPES: Record<string, CareerJob["type"]> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
};

function normalized(value: string | undefined, limit: number): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function mapJob(row: JobRow): CareerJob {
  let requirements: string[] = [];
  try {
    const parsed =
      typeof row.requirements === "string"
        ? JSON.parse(row.requirements)
        : row.requirements;
    if (Array.isArray(parsed)) {
      requirements = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch (error) {
    console.error(`Ignoring invalid requirements JSON for job ${row.slug}.`, error);
  }

  const employmentType =
    EMPLOYMENT_TYPES[row.employmentType] ?? "Full-time";
  const posted =
    row.publishedAt === null
      ? "Date not provided"
      : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
          new Date(row.publishedAt),
        );
  const experience = row.experience?.trim();

  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    company: row.companyName,
    initials: row.companyName.slice(0, 2).toUpperCase(),
    location: row.location,
    type: employmentType,
    experience: experience && experience.toLowerCase() !== "null"
      ? experience
      : "Experience not specified",
    match: null,
    salary: row.salary || "Compensation not provided",
    posted,
    description: row.description,
    requirements,
    countryCode: row.countryCode,
    workplaceType: row.workplaceType,
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    applyUrl: row.applicationUrl,
    isSample: Boolean(row.isSample),
    external: row.sourceId !== null,
  };
}

function searchSampleJobs(filters: JobFilters, page: number, pageSize: number): JobSearchPage {
  const query = normalized(filters.query, 100).toLocaleLowerCase();
  const location = normalized(filters.location, 100).toLocaleLowerCase();
  const country = normalized(filters.country, 2).toUpperCase();
  const selectedEmployment = filters.employmentType ?? "";
  const selectedWorkplace = filters.workplaceType ?? "";
  const selectedSource = filters.sourceType ?? "";

  const filtered = careerJobs.filter((job) => {
    const text = `${job.title} ${job.company} ${job.location} ${job.description} ${job.requirements.join(" ")}`.toLocaleLowerCase();
    const employment = Object.entries(EMPLOYMENT_TYPES).find(([, label]) => label === job.type)?.[0] ?? "";
    return (
      (!query || text.includes(query)) &&
      (!location || job.location.toLocaleLowerCase().includes(location)) &&
      (!country || job.countryCode === country) &&
      (!selectedEmployment || employment === selectedEmployment) &&
      (!selectedWorkplace || job.workplaceType === selectedWorkplace) &&
      (!selectedSource || job.sourceType === selectedSource)
    );
  });

  const start = (page - 1) * pageSize;
  return {
    jobs: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
    mode: "demo",
  };
}

export async function searchJobs(filters: JobFilters = {}): Promise<JobSearchPage> {
  const page = Number.isInteger(filters.page) && (filters.page ?? 0) > 0 ? filters.page ?? 1 : 1;
  const pageSize = Math.min(
    30,
    Math.max(1, Number.isInteger(filters.pageSize) ? filters.pageSize ?? PAGE_SIZE : PAGE_SIZE),
  );
  if (page > MAX_PAGE) throw new Error("The requested job search page is out of range.");
  if (filters.country && !/^[A-Za-z]{2}$/.test(filters.country.trim())) {
    throw new Error("Country must be a two-letter ISO code.");
  }
  if (filters.employmentType && !Object.hasOwn(EMPLOYMENT_TYPES, filters.employmentType)) {
    throw new Error("Employment type is invalid.");
  }
  if (filters.workplaceType && !["onsite", "hybrid", "remote"].includes(filters.workplaceType)) {
    throw new Error("Workplace type is invalid.");
  }
  if (filters.sourceType && !["government", "private"].includes(filters.sourceType)) {
    throw new Error("Job source is invalid.");
  }

  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    return searchSampleJobs(filters, page, pageSize);
  }

  const query = normalized(filters.query, 100).replace(/[^\p{L}\p{N}\s.+-]/gu, "");
  const booleanQuery = booleanPrefixSearch(query);
  const location = normalized(filters.location, 100).replace(/[^\p{L}\p{N}\s,.-]/gu, "");
  const country = normalized(filters.country, 2).toUpperCase();
  const conditions = [
    "j.status = 'published'",
    "j.moderation_hidden = FALSE",
    "(j.expires_at IS NULL OR j.expires_at > CURRENT_TIMESTAMP)",
    "(j.source_id IS NULL OR EXISTS (SELECT 1 FROM job_sources s WHERE s.id = j.source_id AND s.verified = TRUE AND s.enabled = TRUE))",
    "(j.employer_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = j.employer_id AND u.role = 'recruiter' AND u.recruiter_verified = TRUE))",
  ];
  const values: Array<string | number> = [];

  if (query) {
    if (booleanQuery) {
      conditions.push("MATCH(j.title, j.company_name, j.location, j.description) AGAINST (? IN BOOLEAN MODE)");
      values.push(booleanQuery);
    } else {
      const prefix = `${query}%`;
      conditions.push("(j.title LIKE ? OR j.company_name LIKE ? OR j.location LIKE ?)");
      values.push(prefix, prefix, prefix);
    }
  }
  if (location) {
    conditions.push("j.location LIKE ?");
    values.push(`${location}%`);
  }
  if (country) {
    if (!/^[A-Z]{2}$/.test(country)) throw new Error("Country must be a two-letter ISO code.");
    conditions.push("j.country_code = ?");
    values.push(country);
  }
  if (filters.employmentType) {
    if (!Object.hasOwn(EMPLOYMENT_TYPES, filters.employmentType)) {
      throw new Error("Employment type is invalid.");
    }
    conditions.push("j.employment_type = ?");
    values.push(filters.employmentType);
  }
  if (filters.workplaceType) {
    if (!["onsite", "hybrid", "remote"].includes(filters.workplaceType)) {
      throw new Error("Workplace type is invalid.");
    }
    conditions.push("j.workplace_type = ?");
    values.push(filters.workplaceType);
  }
  if (filters.sourceType) {
    if (!["government", "private"].includes(filters.sourceType)) {
      throw new Error("Job source is invalid.");
    }
    conditions.push("(j.source_id IS NULL AND ? = 'private' OR EXISTS (SELECT 1 FROM job_sources source_filter WHERE source_filter.id = j.source_id AND source_filter.source_type = ?))");
    values.push(filters.sourceType, filters.sourceType);
  }

  const where = conditions.join(" AND ");
  const database = getDatabase();
  const [countRows] = await database.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM jobs j WHERE ${where}`,
    values,
  );
  const total = Number(countRows[0]?.total ?? 0);
  const offset = (page - 1) * pageSize;
  const [rows] = await database.execute<JobRow[]>(
    `SELECT j.id, j.slug, j.title, j.company_name AS companyName, j.location,
            j.country_code AS countryCode,
            j.employment_type AS employmentType,
            j.workplace_type AS workplaceType, j.experience, j.salary,
            j.description, j.requirements, j.application_url AS applicationUrl,
            j.source_url AS sourceUrl, COALESCE(s.source_type, 'private') AS sourceType,
            j.is_sample AS isSample, j.source_id AS sourceId,
            j.published_at AS publishedAt,
            COALESCE(s.name, IF(j.is_sample, 'CareerVerse sample', 'Direct employer')) AS sourceName
     FROM jobs j
     LEFT JOIN job_sources s ON s.id = j.source_id
     WHERE ${where}
     ORDER BY j.published_at DESC, j.id DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset],
  );

  return { jobs: rows.map(mapJob), total, page, pageSize, mode: "live" };
}

export async function getLiveJobBySlug(slug: string): Promise<CareerJob | undefined> {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) return undefined;
  const [rows] = await getDatabase().execute<JobRow[]>(
    `SELECT j.id, j.slug, j.title, j.company_name AS companyName, j.location,
            j.country_code AS countryCode,
            j.employment_type AS employmentType,
            j.workplace_type AS workplaceType, j.experience, j.salary,
            j.description, j.requirements, j.application_url AS applicationUrl,
            j.source_url AS sourceUrl, COALESCE(s.source_type, 'private') AS sourceType,
            j.is_sample AS isSample, j.source_id AS sourceId,
            j.published_at AS publishedAt,
            COALESCE(s.name, IF(j.is_sample, 'CareerVerse sample', 'Direct employer')) AS sourceName
     FROM jobs j
     LEFT JOIN job_sources s ON s.id = j.source_id
     WHERE j.slug = ? AND j.status = 'published' AND j.moderation_hidden = FALSE
       AND (j.expires_at IS NULL OR j.expires_at > CURRENT_TIMESTAMP)
       AND (j.source_id IS NULL OR EXISTS (
         SELECT 1 FROM job_sources s
         WHERE s.id = j.source_id AND s.verified = TRUE AND s.enabled = TRUE
       ))
       AND (j.employer_id IS NULL OR EXISTS (
         SELECT 1 FROM users u
         WHERE u.id = j.employer_id AND u.role = 'recruiter' AND u.recruiter_verified = TRUE
       ))
     LIMIT 1`,
    [slug],
  );
  return rows[0] ? mapJob(rows[0]) : undefined;
}
