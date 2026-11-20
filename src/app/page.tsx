import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { homePathFor } from "@/lib/auth/permissions";

export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? homePathFor(user) : "/login");
}
