import type { RowDataPacket } from "mysql2";
import { getDatabase } from "@/lib/db";

type CountRow = RowDataPacket & { count: number | string };

export type AdminRecruiterReview = {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  companyName: string | null;
};

export type AdminRecentUser = {
  id: string;
  fullName: string;
  email: string;
  role: "job_seeker" | "recruiter" | "admin";
  recruiterVerified: boolean;
  createdAt: string;
};

export type AdminJob = {
  id: string;
  title: string;
  companyName: string;
  location: string;
  status: "draft" | "published" | "closed";
  moderationHidden: boolean;
  applications: number;
  createdAt: string;
  employerName: string;
};

export type AdminUserPage = {
  users: AdminRecentUser[];
  page: number;
  pageSize: number;
  total: number;
};

export type AdminUserRole = "all" | "job_seeker" | "recruiter" | "admin";

export type AdminOverview = {
  metrics: {
    users: number;
    recruiters: number;
    pendingRecruiters: number;
    publishedJobs: number;
    applications: number;
    newUsersThisWeek: number;
  };
  pendingReviews: AdminRecruiterReview[];
  verifiedRecruiters: AdminRecruiterReview[];
  recentUsers: AdminRecentUser[];
  jobs: AdminJob[];
};

const ADMIN_USER_PAGE_SIZE = 20;

export async function getAdminUsers(
  search: string,
  role: AdminUserRole,
  page: number,
): Promise<AdminUserPage> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  const normalizedSearch = search.trim();

  if (normalizedSearch) {
    conditions.push("(full_name LIKE ? OR email LIKE ?)");
    const pattern = `%${normalizedSearch}%`;
    values.push(pattern, pattern);
  }
  if (role !== "all") {
    conditions.push("role = ?");
    values.push(role);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const database = getDatabase();
  const [countRows] = await database.execute<CountRow[]>(
    `SELECT COUNT(*) AS count FROM users ${where}`,
    values,
  );
  const total = Number(countRows[0]?.count ?? 0);
  const pageSize = ADMIN_USER_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * pageSize;

  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) AS id, full_name AS fullName, email, role,
            recruiter_verified AS recruiterVerified,
            DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt
     FROM users ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset],
  );

  return {
    users: rows.map((row) => ({
      ...row,
      recruiterVerified: Boolean(row.recruiterVerified),
    })) as AdminRecentUser[],
    page: currentPage,
    pageSize,
    total,
  };
}

async function count(sql: string): Promise<number> {
  const [rows] = await getDatabase().execute<CountRow[]>(sql);
  return Number(rows[0]?.count ?? 0);
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [users, recruiters, pendingRecruiters, publishedJobs, applications, newUsersThisWeek] =
    await Promise.all([
      count("SELECT COUNT(*) AS count FROM users WHERE role <> 'admin'"),
      count("SELECT COUNT(*) AS count FROM users WHERE role = 'recruiter'"),
      count("SELECT COUNT(*) AS count FROM users WHERE role = 'recruiter' AND recruiter_verified = FALSE"),
      count("SELECT COUNT(*) AS count FROM jobs WHERE status = 'published' AND is_sample = FALSE AND moderation_hidden = FALSE"),
      count("SELECT COUNT(*) AS count FROM applications"),
      count("SELECT COUNT(*) AS count FROM users WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY AND role <> 'admin'"),
    ]);

  const [pendingRows] = await getDatabase().execute<RowDataPacket[]>(
    `SELECT CAST(u.id AS CHAR) AS id, u.full_name AS fullName, u.email,
            DATE_FORMAT(u.created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt,
            cp.company_name AS companyName
     FROM users u
     LEFT JOIN company_profiles cp ON cp.owner_user_id = u.id
     WHERE u.role = 'recruiter' AND u.recruiter_verified = FALSE
     ORDER BY u.created_at ASC
     LIMIT 100`,
  );

  const [verifiedRows] = await getDatabase().execute<RowDataPacket[]>(
    `SELECT CAST(u.id AS CHAR) AS id, u.full_name AS fullName, u.email,
            DATE_FORMAT(u.created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt,
            cp.company_name AS companyName
     FROM users u
     LEFT JOIN company_profiles cp ON cp.owner_user_id = u.id
     WHERE u.role = 'recruiter' AND u.recruiter_verified = TRUE
     ORDER BY u.updated_at DESC, u.id DESC
     LIMIT 50`,
  );

  const [recentRows] = await getDatabase().execute<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) AS id, full_name AS fullName, email, role,
            recruiter_verified AS recruiterVerified,
            DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt
     FROM users
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
  );

  const [jobRows] = await getDatabase().execute<RowDataPacket[]>(
    `SELECT CAST(j.id AS CHAR) AS id, j.title, j.company_name AS companyName,
            j.location, j.status, j.moderation_hidden AS moderationHidden, COUNT(a.id) AS applications,
            DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS createdAt,
            u.full_name AS employerName
     FROM jobs j
     INNER JOIN users u ON u.id = j.employer_id
     LEFT JOIN applications a ON a.job_id = j.id
     WHERE j.source_id IS NULL AND j.is_sample = FALSE
     GROUP BY j.id, j.title, j.company_name, j.location, j.status, j.moderation_hidden, j.created_at, u.id, u.full_name
     ORDER BY j.created_at DESC, j.id DESC
     LIMIT 50`,
  );

  return {
    metrics: { users, recruiters, pendingRecruiters, publishedJobs, applications, newUsersThisWeek },
    pendingReviews: pendingRows.map((row) => ({
      ...row,
      companyName: row.companyName ?? null,
    })) as AdminRecruiterReview[],
    verifiedRecruiters: verifiedRows.map((row) => ({
      ...row,
      companyName: row.companyName ?? null,
    })) as AdminRecruiterReview[],
    recentUsers: recentRows.map((row) => ({
      ...row,
      recruiterVerified: Boolean(row.recruiterVerified),
    })) as AdminRecentUser[],
    jobs: jobRows.map((row) => ({
      ...row,
      applications: Number(row.applications),
      moderationHidden: Boolean(row.moderationHidden),
    })) as AdminJob[],
  };
}
