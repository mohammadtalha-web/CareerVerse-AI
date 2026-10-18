import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getDatabase } from "@/lib/db";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 10;
const CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_BATCH_SIZE = 1_000;

type RateLimitRow = RowDataPacket & {
  bucketHash: string;
  attemptCount: number;
  retryAfterSeconds: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

declare global {
  var careerVerseAuthRateLimitCleanupAt: number | undefined;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function cleanExpiredBuckets(): Promise<void> {
  const now = Date.now();
  const lastCleanup = globalThis.careerVerseAuthRateLimitCleanupAt ?? 0;
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  globalThis.careerVerseAuthRateLimitCleanupAt = now;
  try {
    await getDatabase().execute(
      `DELETE FROM auth_rate_limits
       WHERE window_expires_at <= UTC_TIMESTAMP(3)
       ORDER BY window_expires_at
       LIMIT ${CLEANUP_BATCH_SIZE}`,
    );
  } catch (error) {
    globalThis.careerVerseAuthRateLimitCleanupAt = 0;
    throw error;
  }
}

export async function consumeLoginAttempts(keys: string[]): Promise<RateLimitDecision[]> {
  if (keys.length === 0) return [];

  await cleanExpiredBuckets();
  const hashes = keys.map(hashKey);
  const placeholders = hashes.map(() => "(?, 1, TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)))").join(", ");
  const parameters = hashes.flatMap((hash) => [hash, WINDOW_SECONDS]);

  await getDatabase().execute(
    `INSERT INTO auth_rate_limits (bucket_hash, attempt_count, window_expires_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       attempt_count = IF(
         window_expires_at <= UTC_TIMESTAMP(3),
         1,
         LEAST(attempt_count + 1, ${MAX_ATTEMPTS + 1})
       ),
       window_expires_at = IF(
         window_expires_at <= UTC_TIMESTAMP(3),
         TIMESTAMPADD(SECOND, ${WINDOW_SECONDS}, UTC_TIMESTAMP(3)),
         window_expires_at
       )`,
    parameters,
  );

  const [rows] = await getDatabase().execute<RateLimitRow[]>(
    `SELECT bucket_hash AS bucketHash, attempt_count AS attemptCount,
            GREATEST(
              1,
              CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), window_expires_at) / 1000000)
            ) AS retryAfterSeconds
     FROM auth_rate_limits
     WHERE bucket_hash IN (${hashes.map(() => "?").join(", ")})`,
    hashes,
  );
  const decisions = new Map(
    rows.map((row) => [
      row.bucketHash,
      {
        allowed: Number(row.attemptCount) <= MAX_ATTEMPTS,
        retryAfterSeconds: Number(row.retryAfterSeconds),
      },
    ]),
  );

  return hashes.map((hash) => {
    const decision = decisions.get(hash);
    if (!decision) throw new Error("Rate limit state was not returned by the database.");
    return decision;
  });
}

export async function clearLoginAttempts(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const hashes = keys.map(hashKey);
  await getDatabase().execute(
    `DELETE FROM auth_rate_limits
     WHERE bucket_hash IN (${hashes.map(() => "?").join(", ")})`,
    hashes,
  );
}
