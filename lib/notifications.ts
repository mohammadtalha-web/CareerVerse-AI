import "server-only";

import { createHash } from "node:crypto";
import webPush from "web-push";
import type { RowDataPacket } from "mysql2";
import { getDatabase } from "@/lib/db";

export type NotificationType =
  | "job_match"
  | "message"
  | "connection_request"
  | "connection_accepted"
  | "application_received"
  | "application_update";

export type NewNotification = {
  userId: number;
  actorUserId?: number | null;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
};

type PushSubscriptionRow = RowDataPacket & {
  endpointHash: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
};

type JobMatchRow = RowDataPacket & {
  userId: number;
  headline: string;
  location: string;
  skills: unknown;
  queryText: string | null;
  locationText: string | null;
};

type PublishedJobRow = RowDataPacket & {
  id: number;
  employerId: number | null;
  slug: string;
  title: string;
  companyName: string;
  location: string;
  description: string;
  requirements: unknown;
};

export function getPushConfiguration() {
  const publicKey = process.env.CAREERVERSE_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.CAREERVERSE_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.CAREERVERSE_VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !/^(mailto:.+|https:\/\/.+)$/i.test(subject)) {
    throw new Error("Web Push needs CAREERVERSE_VAPID_PUBLIC_KEY, CAREERVERSE_VAPID_PRIVATE_KEY, and a mailto: or HTTPS CAREERVERSE_VAPID_SUBJECT.");
  }
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey) || !/^[A-Za-z0-9_-]{40,100}$/.test(privateKey)) {
    throw new Error("The configured Web Push VAPID keys are invalid.");
  }
  return { publicKey, privateKey, subject };
}

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

async function deliverPush(userId: number, notification: NewNotification): Promise<void> {
  let configuration: ReturnType<typeof getPushConfiguration>;
  try {
    configuration = getPushConfiguration();
  } catch (error) {
    console.error("Web Push configuration is invalid; the in-app notification was saved.", error);
    return;
  }
  if (!configuration) return;

  const [subscriptions] = await getDatabase().execute<PushSubscriptionRow[]>(
    `SELECT endpoint_hash AS endpointHash, endpoint, p256dh_key AS p256dhKey,
            auth_key AS authKey
     FROM push_subscriptions WHERE user_id = ?`,
    [userId],
  );
  if (!subscriptions.length) return;

  webPush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.href,
  });
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
      }, payload, { TTL: 86400, urgency: "normal" });
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        await getDatabase().execute(
          "DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?",
          [subscription.endpointHash, userId],
        );
        return;
      }
      console.error("Sending a browser push notification failed; the in-app notification remains available.", error);
    }
  }));
}

export async function createNotification(notification: NewNotification): Promise<void> {
  const [result] = await getDatabase().execute(
    `INSERT IGNORE INTO notifications
       (user_id, actor_user_id, notification_type, title, body, href, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      notification.userId,
      notification.actorUserId ?? null,
      notification.type,
      notification.title.slice(0, 160),
      notification.body.slice(0, 500),
      notification.href,
      notification.dedupeKey.slice(0, 190),
    ],
  );
  if ("affectedRows" in result && result.affectedRows > 0) {
    await deliverPush(notification.userId, notification);
  }
}

export async function notifyAfterEvent(notification: NewNotification): Promise<void> {
  try {
    await createNotification(notification);
  } catch (error) {
    console.error(`Could not save ${notification.type} notification.`, error);
  }
}

function meaningfulTerms(value: string): string[] {
  const ignored = new Set(["and", "for", "with", "from", "the", "job", "jobs", "role", "work", "near"]);
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])]
    .filter((term) => !ignored.has(term))
    .slice(0, 20);
}

function asStringArray(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch (error) {
    console.error("Ignoring invalid job requirement data while matching notifications.", error);
    return [];
  }
}

function hasTermMatch(terms: string[], text: string): boolean {
  const normalized = text.toLocaleLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function locationMatches(preferred: string, actual: string): boolean {
  const wanted = preferred.trim().toLocaleLowerCase();
  return !wanted || actual.toLocaleLowerCase().includes(wanted);
}

export async function notifyMembersAboutJob(jobId: number): Promise<void> {
  try {
    const [jobs] = await getDatabase().execute<PublishedJobRow[]>(
      `SELECT id, employer_id AS employerId, slug, title, company_name AS companyName,
              location, description, requirements
       FROM jobs WHERE id = ? AND status = 'published' AND is_sample = FALSE
         AND moderation_hidden = FALSE
         AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
         AND (employer_id IS NULL OR EXISTS (
           SELECT 1 FROM users employer
           WHERE employer.id = jobs.employer_id
             AND employer.role = 'recruiter' AND employer.recruiter_verified = TRUE
         ))
         AND (source_id IS NULL OR EXISTS (
           SELECT 1 FROM job_sources source
           WHERE source.id = jobs.source_id AND source.verified = TRUE AND source.enabled = TRUE
         ))
       LIMIT 1`,
      [jobId],
    );
    const job = jobs[0];
    if (!job) return;

    const [candidates] = await getDatabase().execute<JobMatchRow[]>(
      `SELECT profile.user_id AS userId, profile.headline, profile.location, profile.skills,
              history.query_text AS queryText, history.location_text AS locationText
       FROM networking_profiles profile
       LEFT JOIN job_search_history history
         ON history.user_id = profile.user_id
        AND history.last_searched_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY
       WHERE profile.visibility = 'public' AND profile.moderation_hidden = FALSE
         AND (? IS NULL OR profile.user_id <> ?)
       UNION ALL
       SELECT history.user_id AS userId, '' AS headline, '' AS location, '[]' AS skills,
              history.query_text AS queryText, history.location_text AS locationText
       FROM job_search_history history
       WHERE history.last_searched_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY
         AND NOT EXISTS (
           SELECT 1 FROM networking_profiles private_profile
           WHERE private_profile.user_id = history.user_id
             AND private_profile.visibility = 'public'
             AND private_profile.moderation_hidden = FALSE
         )
         AND (? IS NULL OR history.user_id <> ?)`,
      [job.employerId, job.employerId, job.employerId, job.employerId],
    );
    const jobRequirements = asStringArray(job.requirements).join(" ");
    const roleText = `${job.title} ${job.companyName} ${job.description} ${jobRequirements}`;
    const matchedUsers = new Set<number>();

    for (const candidate of candidates) {
      const userId = Number(candidate.userId);
      const profileTerms = meaningfulTerms(`${candidate.headline ?? ""} ${asStringArray(candidate.skills).join(" ")}`);
      const profileMatch = profileTerms.length > 0
        && hasTermMatch(profileTerms, roleText)
        && locationMatches(candidate.location ?? "", job.location);
      const searchTerms = meaningfulTerms(candidate.queryText ?? "");
      const searchMatch = (
        searchTerms.length === 0
          ? Boolean(candidate.locationText?.trim()) && locationMatches(candidate.locationText ?? "", job.location)
          : hasTermMatch(searchTerms, roleText)
      ) && locationMatches(candidate.locationText ?? "", job.location);

      if (userId > 0 && (profileMatch || searchMatch)) matchedUsers.add(userId);
    }

    const notification = {
      type: "job_match" as const,
      actorUserId: job.employerId,
      title: "A new job may fit your profile",
      body: `${job.title} at ${job.companyName} · ${job.location}`,
      href: `/jobs/${encodeURIComponent(job.slug)}`,
    };
    for (const userId of matchedUsers) {
      await notifyAfterEvent({
        ...notification,
        userId,
        dedupeKey: `job:${job.id}`,
      });
    }
  } catch (error) {
    console.error("Matching a newly published job to member notifications failed.", error);
  }
}

export async function recordJobSearch(userId: number, query: string, location: string): Promise<void> {
  const cleanQuery = query.trim().replace(/\s+/g, " ").slice(0, 100);
  const cleanLocation = location.trim().replace(/\s+/g, " ").slice(0, 100);
  if (!cleanQuery && !cleanLocation) return;
  const searchHash = createHash("sha256")
    .update(`${cleanQuery.toLocaleLowerCase()}\n${cleanLocation.toLocaleLowerCase()}`)
    .digest("hex");
  await getDatabase().execute(
    `INSERT INTO job_search_history (user_id, search_hash, query_text, location_text, last_searched_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       query_text = VALUES(query_text), location_text = VALUES(location_text),
       last_searched_at = VALUES(last_searched_at)`,
    [userId, searchHash, cleanQuery, cleanLocation],
  );
  await getDatabase().execute(
    `DELETE FROM job_search_history
     WHERE user_id = ? AND search_hash NOT IN (
       SELECT search_hash FROM (
         SELECT search_hash FROM job_search_history
         WHERE user_id = ? ORDER BY last_searched_at DESC LIMIT 20
       ) recent_searches
     )`,
    [userId, userId],
  );
}
