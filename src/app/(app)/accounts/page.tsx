import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, ChevronLeft, Receipt, Truck, UsersRound } from "lucide-react";
import { SoonBadge } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatMoneyString } from "@/lib/money";
import { getFinanceDashboard } from "@/server/services/finance-summary-service";

export const metadata: Metadata = { title: "الحسابات" };

/** Money hub: where to record and check costs, suppliers and expenses. */
export default async function AccountsPage() {
  const user = await requireUser();
  const finance =
    hasPermission(user, "expenses:view") && hasPermission(user, "suppliers:view") && hasPermission(user, "costs:view")
      ? await getFinanceDashboard(prisma, user)
      : null;

  const links = [
    { href: "/expenses", label: "المصاريف", note: finance ? `الشهر ده: ${formatMoneyString(finance.expensesThisMonth)}` : "إيجار، كهرباء، مستلزمات…", icon: Receipt, show: hasPermission(user, "expenses:view") },
    { href: "/suppliers", label: "الموردين", note: finance ? `لسه علينا: ${formatMoneyString(finance.supplierOutstanding)}` : "المشتريات والدفعات", icon: Truck, show: hasPermission(user, "suppliers:view") },
    { href: "/customers", label: "العملاء", note: "اللي ليهم واللي عليهم", icon: UsersRound, show: hasPermission(user, "customers:view") },
  ].filter((l) => l.show);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">الحسابات</h1>
      {hasPermission(user, "expenses:record") && (
        <Link
          href="/expenses/new"
          className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground"
        >
          <Receipt className="size-5" aria-hidden="true" />
          سجل مصروف
        </Link>
      )}
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {links.map(({ href, label, note, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{note}</p>
              </div>
              <ChevronLeft className="size-5 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
        <li className="flex min-h-16 items-center gap-3 px-4 py-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CalendarRange className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">حسابات الشهر</p>
            <p className="text-xs text-muted-foreground">ملخص الدخل والمصاريف والربح</p>
          </div>
          <SoonBadge />
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        تكلفة كل أوردر بتتسجل من صفحة الأوردر نفسه («إضافة تكلفة»).
      </p>
    </div>
  );
}
