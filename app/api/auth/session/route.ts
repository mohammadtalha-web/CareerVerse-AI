import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { isDatabaseUnavailable, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await getCurrentAccount();
    if (!account) return NextResponse.json({ account: null });
    return NextResponse.json({
      account: {
        id: account.id,
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        recruiterVerified: Boolean(account.recruiterVerified),
      },
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError("Account services are unavailable. Check the database setup and schema.", 503);
    }
    console.error("Unable to read the current session.", error);
    return jsonError("We couldn't check your sign-in status.", 500);
  }
}