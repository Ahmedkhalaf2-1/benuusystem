"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, getRequestIp, readSessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { logout } from "@/server/services/auth-service";

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  try {
    await logout(prisma, token, { ipAddress: await getRequestIp() });
  } finally {
    // Always drop the cookie, even if the database call failed.
    await clearSessionCookie();
  }
  redirect("/login");
}
