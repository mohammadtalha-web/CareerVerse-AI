import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { getAdminUsers, type AdminUserRole } from "@/lib/admin";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

const roles: AdminUserRole[] = ["all", "job_seeker", "recruiter", "admin"];

export async function GET(request: Request) {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to access administration.", 401);
    if (account.role !== "admin") return jsonError("Administrator access is required.", 403);

    const parameters = new URL(request.url).searchParams;
    const search = parameters.get("q")?.trim() ?? "";
    const roleInput = parameters.get("role") ?? "all";
    const pageInput = parameters.get("page") ?? "1";
    if (search.length > 100) return jsonError("Search text must be 100 characters or fewer.", 400);
    if (!roles.includes(roleInput as AdminUserRole)) return jsonError("Choose a valid account type.", 400);
    if (!/^[1-9]\d{0,5}$/.test(pageInput)) return jsonError("Choose a valid page number.", 400);

    const result = await getAdminUsers(search, roleInput as AdminUserRole, Number(pageInput));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Admin services are unavailable. Check the database setup and schema.", 503);
    }
    console.error("Unable to load admin accounts.", error);
    return jsonError("We couldn't load the member directory.", 500);
  }
}
