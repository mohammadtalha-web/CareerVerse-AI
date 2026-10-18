import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { hasTrustedOrigin, isDatabaseUnavailable, jsonError } from "@/lib/http";
import { isRecord } from "@/lib/networking";

type ProfileRow = RowDataPacket & {
  userId: number;
  profileSlug: string;
  headline: string;
  location: string;
  bio: string;
  skills: string[] | string;
  visibility: "private" | "public";
};

function mapProfile(profile: ProfileRow | undefined, fullName: string, photoUrl: string | null) {
  let skills: string[] = [];
  if (profile) {
    try {
      const value = typeof profile.skills === "string" ? JSON.parse(profile.skills) : profile.skills;
      if (Array.isArray(value)) skills = value.filter((skill): skill is string => typeof skill === "string");
    } catch (error) {
      console.error("Unable to read profile skills.", error);
    }
  }
  return {
    fullName,
    slug: profile?.profileSlug ?? "",
    headline: profile?.headline ?? "",
    location: profile?.location ?? "",
    bio: profile?.bio ?? "",
    skills,
    visibility: profile?.visibility ?? "private",
    photoUrl,
  };
}

export async function GET() {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to manage your profile.", 401);
    const [rows] = await getDatabase().execute<ProfileRow[]>(
      `SELECT user_id AS userId, profile_slug AS profileSlug, headline, location, bio, skills, visibility
       FROM networking_profiles WHERE user_id = ? LIMIT 1`,
      [account.id],
    );
    const [photoRows] = await getDatabase().execute<RowDataPacket[]>(
      "SELECT user_id FROM networking_profile_photos WHERE user_id = ? LIMIT 1",
      [account.id],
    );
    const photoUrl = photoRows.length ? `/api/networking/photos/${account.id}` : null;
    return NextResponse.json({ profile: mapProfile(rows[0], account.fullName, photoUrl) });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Profiles are unavailable. Check the database setup.", 503);
    console.error("Loading a networking profile failed.", error);
    return jsonError("We couldn't load your profile.", 500);
  }
}

export async function PUT(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Request origin could not be verified.", 403);
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to update your profile.", 401);
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return jsonError("Send profile details as JSON.", 415);
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > 20_000) return jsonError("The profile request is too large.", 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("The profile request must be valid JSON.", 400);
    }
    if (!isRecord(body)) return jsonError("Profile details are required.", 400);

    const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    const headline = typeof body.headline === "string" ? body.headline.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    const visibility = body.visibility;
    const skills = body.skills;
    if (!/^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/.test(slug)) {
      return jsonError("Profile URL must use 3–80 lowercase letters, numbers, or hyphens.", 400);
    }
    if (headline.length > 160 || location.length > 180 || bio.length > 5000) {
      return jsonError("A profile field exceeds its allowed length.", 400);
    }
    if (visibility !== "private" && visibility !== "public") {
      return jsonError("Choose whether your profile is private or public.", 400);
    }
    if (!Array.isArray(skills) || skills.length > 30 ||
        skills.some((skill) => typeof skill !== "string" || !skill.trim() || skill.length > 60)) {
      return jsonError("Add up to 30 valid skills.", 400);
    }
    const normalizedSkills = [...new Set(skills.map((skill: string) => skill.trim()))];

    const connection = await getDatabase().getConnection();
    try {
      await connection.beginTransaction();
      const [slugRows] = await connection.execute<RowDataPacket[]>(
        "SELECT user_id AS userId FROM networking_profiles WHERE profile_slug = ? FOR UPDATE",
        [slug],
      );
      if (slugRows[0] && Number(slugRows[0].userId) !== account.id) {
        await connection.rollback();
        return jsonError("That profile URL is already in use.", 409);
      }
      const [ownRows] = await connection.execute<RowDataPacket[]>(
        "SELECT user_id FROM networking_profiles WHERE user_id = ? FOR UPDATE",
        [account.id],
      );
      if (ownRows.length) {
        await connection.execute(
          `UPDATE networking_profiles
           SET profile_slug = ?, headline = ?, location = ?, bio = ?, skills = ?, visibility = ?
           WHERE user_id = ?`,
          [slug, headline, location, bio, JSON.stringify(normalizedSkills), visibility, account.id],
        );
      } else {
        await connection.execute(
          `INSERT INTO networking_profiles
             (user_id, profile_slug, headline, location, bio, skills, visibility)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [account.id, slug, headline, location, bio, JSON.stringify(normalizedSkills), visibility],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return NextResponse.json({ saved: true, slug, visibility });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
      return jsonError("That profile URL is already in use.", 409);
    }
    if (isDatabaseUnavailable(error)) return jsonError("Profiles are unavailable. Check the database setup.", 503);
    console.error("Updating a networking profile failed.", error);
    return jsonError("We couldn't save your profile.", 500);
  }
}
