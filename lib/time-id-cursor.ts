export type TimeIdCursor = { timestamp: string; id: number };

export function encodeTimeIdCursor(timestamp: string, id: number): string {
  return Buffer.from(JSON.stringify({ timestamp, id })).toString("base64url");
}

export function decodeTimeIdCursor(value: string | null): TimeIdCursor | null {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("timestamp" in decoded) ||
      typeof decoded.timestamp !== "string" ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(decoded.timestamp) ||
      !("id" in decoded) ||
      typeof decoded.id !== "number" ||
      !Number.isSafeInteger(decoded.id) ||
      decoded.id < 1
    ) {
      return null;
    }
    return { timestamp: decoded.timestamp, id: decoded.id };
  } catch {
    return null;
  }
}
