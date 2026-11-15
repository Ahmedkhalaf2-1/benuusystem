import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "الحسابات" };

export default async function AccountsPage() {
  await requireUser();
  return (
    <ComingSoon
      icon={Wallet}
      title="الحسابات"
      description="هنا ستجد مدفوعات العملاء والمصروفات وحسابات الشهر. هذا القسم قيد التجهيز."
    />
  );
}
