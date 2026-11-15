import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function RootPage() {
  redirect((await getCurrentUser()) ? "/dashboard" : "/login");
}
