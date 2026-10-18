import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminWorkspace from "@/components/AdminWorkspace";
import { getAdminOverview, getAdminUsers, type AdminUserPage } from "@/lib/admin";
import { getCurrentAccount } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin workspace" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  if (account.role !== "admin") redirect("/account");

  let initialOverview = null;
  let initialMembers: AdminUserPage | null = null;
  let loadError = "";
  try {
    [initialOverview, initialMembers] = await Promise.all([
      getAdminOverview(),
      getAdminUsers("", "all", 1),
    ]);
  } catch (error) {
    console.error("Unable to render the admin workspace.", error);
    loadError = "Live admin data is unavailable. Confirm the database is running and the admin migrations 007, 008, 009, and 015 have been applied.";
  }

  return <AdminWorkspace administratorName={account.fullName} initialOverview={initialOverview} initialMembers={initialMembers} loadError={loadError} />;
}
