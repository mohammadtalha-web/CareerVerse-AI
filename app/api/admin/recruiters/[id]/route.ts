import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";

type RecruiterRow = RowDataPacket & { id: number; role: string; recruiterVerified: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Send the review decision as JSON.", 415);
  }
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > 2_048) return jsonError("The request is too large.", 413);

  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to access administration.", 401);
    if (account.role !== "admin") return jsonError("Administrator access is required.", 403);

    const { id: rawId } = await context.params;
    if (!/^[1-9]\d{0,19}$/.test(rawId)) return jsonError("That recruiter account is not valid.", 400);
    const bodyText = await request.text();
    if (Buffer.byteLength(bodyText, "utf8") > 2_048) {
      return jsonError("The request is too large.", 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return jsonError("The request body must be valid JSON.", 400);
    }
    const reason = isRecord(body) && typeof body.reason === "string" ? body.reason.trim() : "";
    if (!isRecord(body) || typeof body.verified !== "boolean") {
      return jsonError("Choose whether to verify this recruiter.", 400);
    }
    if (reason.length < 3 || reason.length > 1000) return jsonError("Provide a reason between 3 and 1,000 characters.", 400);

    const connection = await getDatabase().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RecruiterRow[]>(
        `SELECT id, role, recruiter_verified AS recruiterVerified
         FROM users WHERE id = ? FOR UPDATE`,
        [rawId],
      );
      const recruiter = rows[0];
      if (!recruiter || recruiter.role !== "recruiter") {
        await connection.rollback();
        return jsonError("Recruiter account not found.", 404);
      }

      const currentlyVerified = Boolean(recruiter.recruiterVerified);
      if (currentlyVerified === body.verified) {
        await connection.commit();
        return NextResponse.json({ verified: currentlyVerified });
      }

      await connection.execute(
        "UPDATE users SET recruiter_verified = ? WHERE id = ?",
        [body.verified, rawId],
      );
      await connection.execute(
        "INSERT INTO admin_audit_log (actor_user_id, target_user_id, action, reason) VALUES (?, ?, ?, ?)",
        [account.id, rawId, body.verified ? "recruiter_verified" : "recruiter_unverified", reason],
      );
      await connection.commit();
      return NextResponse.json({ verified: body.verified });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Admin services are unavailable. Check the database setup and schema.", 503);
    }
    console.error("Unable to update recruiter verification.", error);
    return jsonError("We couldn't save this review decision.", 500);
  }
}
