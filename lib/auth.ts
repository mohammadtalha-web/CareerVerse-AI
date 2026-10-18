import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getDatabase } from "@/lib/db";

const SESSION_COOKIE = "careerverse_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_COST = 32_768;

export type Account = {
  id: number;
  email: string;
  fullName: string;
  role: "job_seeker" | "recruiter" | "admin";
  recruiterVerified: boolean;
};

type StoredPassword = {
  salt: string;
  hash: string;
};

function derivePasswordKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      PASSWORD_KEY_LENGTH,
      {
        N: PASSWORD_COST,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

function digestSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<StoredPassword> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await derivePasswordKey(password, salt);

  return { salt, hash: Buffer.from(derivedKey).toString("hex") };
}

export async function verifyPassword(
  password: string,
  stored: StoredPassword,
): Promise<boolean> {
  const expected = Buffer.from(stored.hash, "hex");
  const actual = await derivePasswordKey(password, stored.salt);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createSession(accountId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1000);

  await getDatabase().execute(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [accountId, digestSessionToken(token), expiresAt],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDatabase().execute("DELETE FROM sessions WHERE token_hash = ?", [
      digestSessionToken(token),
    ]);
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentAccount(): Promise<Account | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [rows] = await getDatabase().execute(
    `SELECT users.id, users.email, users.full_name AS fullName,
            users.role, users.recruiter_verified AS recruiterVerified
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > CURRENT_TIMESTAMP
       AND users.is_active = TRUE
     LIMIT 1`,
    [digestSessionToken(token)],
  );
  const account = (rows as Account[])[0];
  return account ? { ...account, recruiterVerified: Boolean(account.recruiterVerified) } : null;
}
