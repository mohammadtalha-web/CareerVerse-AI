import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { getAdminOverview } from "@/lib/admin";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await getCurrentAccount();
    if (!account) return jsonError("Sign in to access administration.", 401);
    if (account.role !== "admin") return jsonError("Administrator access is required.", 403);
    const overview = await getAdminOverview();
    return NextResponse.json(overview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Admin services are unavailable. Check the database setup and schema.", 503);
    }
    console.error("Unable to load the admin overview.", error);
    return jsonError("We couldn't load the administration overview.", 500);
  }
}
