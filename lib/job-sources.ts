import "server-only";

import { isIP } from "node:net";

export type SourceConfiguration = {
  key: string;
  feedUrl: URL;
  apiKeyEnv?: string;
};

type RawConfiguration = {
  key?: unknown;
  feedUrl?: unknown;
  apiKeyEnv?: unknown;
};

function isRecord(value: unknown): value is RawConfiguration {
  return typeof value === "object" && value !== null;
}

function parseFeedUrl(value: string, allowlist: Set<string>): URL | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !allowlist.has(hostname) ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      isIP(hostname)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function getSourceConfigurations(): Map<string, SourceConfiguration> {
  const raw = process.env.JOB_SOURCE_FEEDS_JSON;
  if (!raw) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("JOB_SOURCE_FEEDS_JSON must be a valid JSON array.");
  }
  if (!Array.isArray(parsed) || parsed.length > 30) {
    throw new Error("JOB_SOURCE_FEEDS_JSON must contain at most 30 feed configurations.");
  }
  if (!parsed.length) return new Map();
  const allowedHosts = new Set(
    (process.env.JOB_SOURCE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowedHosts.size) {
    throw new Error("Set JOB_SOURCE_ALLOWED_HOSTS before configuring job-source feeds.");
  }

  const configurations = new Map<string, SourceConfiguration>();
  for (const [index, value] of parsed.entries()) {
    if (!isRecord(value)) throw new Error(`Job source feed ${index + 1} must be an object.`);
    const { key, feedUrl, apiKeyEnv } = value;
    const parsedUrl = typeof feedUrl === "string" ? parseFeedUrl(feedUrl, allowedHosts) : null;
    if (
      typeof key !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{1,49}$/.test(key) ||
      configurations.has(key) ||
      !parsedUrl ||
      (apiKeyEnv !== undefined &&
        (typeof apiKeyEnv !== "string" ||
          !/^JOB_SOURCE_[A-Z0-9_]+_API_KEY$/.test(apiKeyEnv) ||
          !process.env[apiKeyEnv]))
    ) {
      throw new Error(`Job source feed ${index + 1} has invalid settings or a host that is not allowlisted.`);
    }
    configurations.set(key, {
      key,
      feedUrl: parsedUrl,
      ...(typeof apiKeyEnv === "string" ? { apiKeyEnv } : {}),
    });
  }
  return configurations;
}

export function isSafePublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !hostname.endsWith(".local") &&
      !hostname.endsWith(".localhost") &&
      hostname !== "localhost" &&
      !isIP(hostname)
    );
  } catch {
    return false;
  }
}
