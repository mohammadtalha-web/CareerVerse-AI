import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentAccount } from "@/lib/auth";
import { getDatabase } from "@/lib/db";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";
import type { Account } from "@/lib/auth";

type ProfileRow = RowDataPacket & {
  userId: number;
  fullName: string;
  profileSlug: string;
  headline: string;
  location: string;
  bio: string;
  skills: string[] | string;
  visibility: string;
  moderationHidden: number;
  photoUrl: string | null;
};
type ProjectRow = RowDataPacket & {
  id: number;
  title: string;
  description: string;
  projectUrl: string | null;
  createdAt: Date;
};
type UploadRow = RowDataPacket & {
  id: number;
  portfolioId: number;
  originalName: string;
  byteSize: number;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const [rows] = await getDatabase().execute<ProfileRow[]>(
      `SELECT p.user_id AS userId, u.full_name AS fullName, p.profile_slug AS profileSlug,
              p.headline, p.location, p.bio, p.skills, p.visibility,
              CASE WHEN photo.user_id IS NULL THEN NULL
                   ELSE CONCAT('/api/networking/photos/', p.user_id) END AS photoUrl,
              p.moderation_hidden AS moderationHidden
       FROM networking_profiles p
       INNER JOIN users u ON u.id = p.user_id
       LEFT JOIN networking_profile_photos photo ON photo.user_id = p.user_id
       WHERE p.profile_slug = ? LIMIT 1`,
      [slug],
    );
    const profile = rows[0];
    if (!profile) return jsonError("Profile not found.", 404);
    let viewer: Account | null = null;
    try {
      viewer = await getCurrentAccount();
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
    }
    if (profile.visibility !== "public" && viewer?.id !== profile.userId && viewer?.role !== "admin") {
      return jsonError("This profile is private.", 404);
    }
    if (profile.moderationHidden && viewer?.id !== profile.userId && viewer?.role !== "admin") {
      return jsonError("Profile not found.", 404);
    }
    if (viewer && viewer.id !== profile.userId) {
      const [blocked] = await getDatabase().execute<RowDataPacket[]>(
        `SELECT 1 FROM networking_blocks
         WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
         LIMIT 1`,
        [viewer.id, profile.userId, profile.userId, viewer.id],
      );
      if (blocked.length) return jsonError("Profile not found.", 404);
    }
    let relationship: "none" | "incoming" | "outgoing" | "accepted" = "none";
    if (viewer && viewer.id !== profile.userId) {
      const lowId = Math.min(viewer.id, profile.userId);
      const highId = Math.max(viewer.id, profile.userId);
      const [connections] = await getDatabase().execute<RowDataPacket[]>(
        `SELECT requester_id AS requesterId, status FROM networking_connections
         WHERE user_low_id = ? AND user_high_id = ? LIMIT 1`,
        [lowId, highId],
      );
      if (connections[0]?.status === "accepted") relationship = "accepted";
      else if (connections[0]?.status === "pending") {
        relationship = Number(connections[0].requesterId) === viewer.id ? "outgoing" : "incoming";
      }
    }
    let skills: string[] = [];
    try {
      const parsed = typeof profile.skills === "string" ? JSON.parse(profile.skills) : profile.skills;
      if (Array.isArray(parsed)) skills = parsed.filter((item): item is string => typeof item === "string");
    } catch (error) {
      console.error("Unable to read public profile skills.", error);
    }
    const [projects] = await getDatabase().execute<ProjectRow[]>(
      `SELECT p.id, p.title, p.description, p.project_url AS projectUrl, p.created_at AS createdAt
       FROM networking_portfolio p
       WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 50`,
      [profile.userId],
    );
    const projectIds = projects.map((project) => Number(project.id));
    const uploadsByProject = new Map<number, UploadRow[]>();
    if (projectIds.length) {
      const [uploads] = await getDatabase().execute<UploadRow[]>(
        `SELECT id, portfolio_id AS portfolioId, original_name AS originalName, byte_size AS byteSize
         FROM networking_uploads WHERE portfolio_id IN (${projectIds.map(() => "?").join(",")})
         ORDER BY id`,
        projectIds,
      );
      for (const upload of uploads) {
        const group = uploadsByProject.get(Number(upload.portfolioId)) ?? [];
        group.push(upload);
        uploadsByProject.set(Number(upload.portfolioId), group);
      }
    }
    return NextResponse.json({
      profile: {
        userId: profile.userId,
        fullName: profile.fullName,
        slug: profile.profileSlug,
        headline: profile.headline,
        location: profile.location,
        bio: profile.bio,
        skills,
        visibility: profile.visibility,
        photoUrl: profile.photoUrl,
        moderationHidden: Boolean(profile.moderationHidden),
        isOwner: viewer?.id === profile.userId,
        relationship,
      },
      portfolio: projects.map((project) => ({ ...project, uploads: uploadsByProject.get(Number(project.id)) ?? [] })),
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) return jsonError("Profiles are unavailable. Check the database setup.", 503);
    console.error("Loading a public profile failed.", error);
    return jsonError("We couldn't load this profile.", 500);
  }
}
