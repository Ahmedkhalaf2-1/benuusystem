import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarRange, ChevronLeft, HardHat, Receipt, Truck, UsersRound } from "lucide-react";
import { HueIcon, type Hue } from "@/components/ds/primitives";
import { SoonBadge } from "@/components/coming-soon";
import { Flash } from "@/components/flash";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatMoneyString } from "@/lib/money";
import { getFinanceDashboard } from "@/server/services/finance-summary-service";
import { getDashboardStats } from "@/server/services/order-service";

export const metadata: Metadata = { title: "الحسابات" };

/** Money hub: where to record and check costs, suppliers and expenses. */
export default async function AccountsPage(props: PageProps<"/accounts">) {
  const user = await requireUser();
  const { saved } = await props.searchParams;
  const finance = hasPermission(user, "finance:view-summary") ? await getFinanceDashboard(prisma, user) : null;
  const stats = finance ? await getDashboardStats(prisma, user) : null;

  const links = [
    { href: "/expenses", label: "المصاريف", note: finance ? `الشهر ده ${formatMoneyString(finance.expensesThisMonth)}` : "إيجار، كهرباء، مستلزمات…", icon: Receipt, hue: "amber" as Hue, show: hasPermission(user, "expenses:view") },
    { href: "/suppliers", label: "الموردين", note: finance ? `لسه علينا ${formatMoneyString(finance.supplierOutstanding)}` : "المشتريات والدفعات", icon: Truck, hue: "blue" as Hue, show: hasPermission(user, "suppliers:view-balances") },
    { href: "/workers/summary", label: "حساب العمال", note: "اليوميات واللي اتدفع واللي لسه", icon: HardHat, hue: "rose" as Hue, show: hasPermission(user, "workers:view-pay") },
    { href: "/customers", label: "العملاء", note: "اللي ليهم واللي عليهم", icon: UsersRound, hue: "violet" as Hue, show: hasPermission(user, "customers:view") },
  ].filter((l) => l.show);

  return (
    <div className="space-y-6">
      <Flash message={saved === "expense" ? "تم حفظ المصروف ✓" : undefined} />
      <h1 className="font-display text-[1.75rem] leading-[1.35] font-semibold tracking-[-0.02em]">الحسابات</h1>

      {finance && stats && (
        <section aria-label="فلوس الشهر ده" className="relative overflow-hidden rounded-[1.75rem] bg-ink p-5 text-white shadow-[var(--shadow-lift)]">
          <span aria-hidden="true" className="pointer-events-none absolute -top-16 -start-10 size-44 rounded-full bg-green/25 blur-3xl" />
          <div className="relative">
            <p className="text-sm font-semibold text-white/75">فلوس الشهر ده (كاش فعلي)</p>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10">
                <dt className="flex items-center gap-1.5 text-xs text-white/65">
                  <ArrowDownLeft className="size-3.5 text-[#7ee2a8]" aria-hidden="true" />
                  دخل من العملاء
                </dt>
                <dd className="tabular mt-1 font-display text-xl font-semibold text-[#7ee2a8]">{formatMoneyString(stats.paymentsThisMonth ?? "0")}</dd>
              </div>
              <div className="rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10">
                <dt className="flex items-center gap-1.5 text-xs text-white/65">
                  <ArrowUpRight className="size-3.5 text-[#ffb28a]" aria-hidden="true" />
                  خرج كاش (موردين ومصاريف وعمال)
                </dt>
                <dd className="tabular mt-1 font-display text-xl font-semibold text-[#ffb28a]">{formatMoneyString(finance.paidOutThisMonth)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm font-semibold text-white/75">مصاريف وفلوس علينا</p>
            <dl className="mt-2 divide-y divide-white/10 text-sm">
              <div className="flex items-baseline justify-between py-2">
                <dt className="text-white/70">مصاريف اتسجلت الشهر ده</dt>
                <dd className="tabular font-display font-semibold">{formatMoneyString(finance.expensesThisMonth)}</dd>
              </div>
              <div className="flex items-baseline justify-between py-2">
                <dt className="text-white/70">اتدفع منها</dt>
                <dd className="tabular font-display font-semibold">{formatMoneyString(finance.expensesPaidThisMonth)}</dd>
              </div>
              <div className="flex items-baseline justify-between py-2">
                <dt className="text-white/70">لسه علينا للموردين</dt>
                <dd className="tabular font-display font-semibold">{formatMoneyString(finance.supplierOutstanding)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[0.7rem] leading-relaxed text-white/50">المصروف بيتحسب لما يتسجل، والكاش لما يتدفع فعلًا. الربح هيتحسب لما مرحلة حسابات الشهر تتعمل.</p>
          </div>
        </section>
      )}

      {hasPermission(user, "expenses:record") && (
        <Link
          href="/expenses/new"
          className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#f2a623] to-amber-ink font-display text-lg font-semibold text-white shadow-[0_14px_30px_-12px_rgb(232_150_12/0.75)] transition-transform active:scale-[0.98]"
        >
          <Receipt className="size-5" aria-hidden="true" />
          سجل مصروف
        </Link>
      )}

      <ul className="grid grid-cols-2 gap-3">
        {links.map(({ href, label, note, icon, hue }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex h-full min-h-32 flex-col gap-3 rounded-[1.4rem] bg-surface p-4 shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-200 hover:shadow-[var(--shadow-lift)] active:scale-[0.97]"
            >
              <HueIcon icon={icon} hue={hue} />
              <span className="mt-auto">
                <span className="flex items-center justify-between font-display font-semibold">
                  {label}
                  <ChevronLeft className="size-4 text-graphite" aria-hidden="true" />
                </span>
                <span className="tabular mt-0.5 block text-xs text-graphite">{note}</span>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <div className="flex h-full min-h-32 flex-col gap-3 rounded-[1.4rem] bg-surface/70 p-4 shadow-[var(--shadow-soft)]">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-muted text-graphite">
              <CalendarRange className="size-5" aria-hidden="true" />
            </span>
            <span className="mt-auto">
              <span className="flex items-center justify-between font-display font-semibold">
                حسابات الشهر
                <SoonBadge />
              </span>
              <span className="mt-0.5 block text-xs text-graphite">ملخص الدخل والمصاريف والربح</span>
            </span>
          </div>
        </li>
      </ul>
      <p className="text-xs text-graphite">تكلفة كل أوردر بتتسجل من صفحة الأوردر نفسه («إضافة تكلفة»).</p>
    </div>
  );
}
