import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { isRecord } from "@/lib/networking";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const MAX_PAGE = 100_000;

type UniversityRow = RowDataPacket & {
  id: number | string;
  name: string;
  memberCount: number | string;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const requestedPage = Number(url.searchParams.get("page") ?? "1");
    const page = Number.isInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, MAX_PAGE)
      : 1;
    const sort = url.searchParams.get("sort") === "name" ? "name" : "members";
    const conditions = search ? "AND universities.name LIKE ? ESCAPE '\\\\'" : "";
    const params = search ? [`%${escapeLike(search)}%`] : [];
    const account = await getCurrentAccount();
    const db = getDatabase();
    const [summaryRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT users.university_id) AS universityCount,
              COUNT(users.id) AS memberCount
       FROM users
       WHERE users.university_id IS NOT NULL`,
    );
    const summary = summaryRows[0];
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM universities
       INNER JOIN users ON users.university_id = universities.id
       WHERE 1 = 1 ${conditions}`,
      params,
    );
    const orderBy = sort === "name"
      ? "universities.name ASC"
      : "memberCount DESC, universities.name ASC";
    const offset = (page - 1) * PAGE_SIZE;
    const [universities] = await db.execute<UniversityRow[]>(
      `SELECT universities.id, universities.name, COUNT(users.id) AS memberCount
       FROM universities
       INNER JOIN users ON users.university_id = universities.id
       WHERE 1 = 1 ${conditions}
       GROUP BY universities.id, universities.name
       ORDER BY ${orderBy}
       LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      params,
    );
    let myUniversity: string | null = null;
    if (account) {
      const [accountRows] = await db.execute<RowDataPacket[]>(
        `SELECT universities.name
         FROM users
         LEFT JOIN universities ON universities.id = users.university_id
         WHERE users.id = ?
         LIMIT 1`,
        [account.id],
      );
      myUniversity = typeof accountRows[0]?.name === "string" ? accountRows[0].name : null;
    }
    return NextResponse.json(
      {
        universities: universities.map((university) => ({
          id: String(university.id),
          name: university.name,
          memberCount: Number(university.memberCount),
        })),
        total: Number(countRows[0]?.total ?? 0),
        page,
        pageSize: PAGE_SIZE,
        universityCount: Number(summary?.universityCount ?? 0),
        memberCount: Number(summary?.memberCount ?? 0),
        isSignedIn: account !== null,
        myUniversity,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("University information is unavailable. Check the database connection and schema.", 503);
    }
    console.error("Unable to load Academic Communities data.", error);
    return jsonError("We couldn't load Academic Communities.", 500);
  }
}

export async function PUT(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to update your university affiliation.", 401);
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return jsonError("Send your university as JSON.", 415);
    }
    const declaredSize = Number(request.headers.get("content-length") ?? "0");
    if (declaredSize > 1_024) return jsonError("The request is too large.", 413);
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 1_024) return jsonError("The request is too large.", 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return jsonError("The request body must be valid JSON.", 400);
    }
    if (!isRecord(body) || typeof body.university !== "string") {
      return jsonError("Enter a university name or leave it blank to remove your affiliation.", 400);
    }
    const university = body.university.trim().replace(/\s+/g, " ");
    if (university.length > 160 || (university.length > 0 && university.length < 2)) {
      return jsonError("University names must be between 2 and 160 characters.", 400);
    }

    const connection = await getDatabase().getConnection();
    try {
      await connection.beginTransaction();
      if (university) {
        const [result] = await connection.execute<ResultSetHeader>(
          "INSERT INTO universities (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
          [university],
        );
        const universityId = Number(result.insertId);
        await connection.execute("UPDATE users SET university_id = ? WHERE id = ?", [
          universityId,
          account.id,
        ]);
      } else {
        const [previousRows] = await connection.execute<RowDataPacket[]>(
          "SELECT university_id AS universityId FROM users WHERE id = ? FOR UPDATE",
          [account.id],
        );
        const previousId = previousRows[0]?.universityId;
        await connection.execute("UPDATE users SET university_id = NULL WHERE id = ?", [account.id]);
        if (previousId !== null && previousId !== undefined) {
          await connection.execute(
            `DELETE FROM universities
             WHERE id = ?
               AND NOT EXISTS (SELECT 1 FROM users WHERE university_id = ?)`,
            [previousId, previousId],
          );
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return NextResponse.json(
      { university: university || null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("University information is unavailable. Check the database connection and schema.", 503);
    }
    console.error("Unable to update university affiliation.", error);
    return jsonError("We couldn't update your university affiliation.", 500);
  }
}
