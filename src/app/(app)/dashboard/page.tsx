import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, Banknote, CheckCircle2, HardHat, PackageCheck, Receipt, Truck, Wallet } from "lucide-react";
import { SoonBadge } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { todayDateString } from "@/lib/dates";
import { prisma } from "@/lib/db/prisma";
import { greetingAr } from "@/lib/format";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { getFinanceDashboard } from "@/server/services/finance-summary-service";
import { getMonthlyWorkerSummary, getTodayAttendance } from "@/server/services/labor-service";
import { getDashboardStats } from "@/server/services/order-service";
import { getProductionDashboard } from "@/server/services/production-service";
import { UNIT_LABELS } from "@/lib/orders/labels";
import { QUICK_ACTIONS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "الرئيسية" };

/**
 * Statistic cards. Numbers come from PostgreSQL; cards whose module does not
 * exist yet stay "—". No placeholder figures are ever shown as real data.
 */
type Stat = { key: string; label: string; icon: typeof PackageCheck; value?: string; note?: string; href?: string; alert?: boolean };

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.name.trim().split(/\s+/)[0];
  const canSeeMoney = hasPermission(user, "finance:view-summary");
  const [stats, production, finance, attendance, workersMonth] = await Promise.all([
    getDashboardStats(prisma, user),
    getProductionDashboard(prisma, user),
    canSeeMoney ? getFinanceDashboard(prisma, user) : null,
    hasPermission(user, "workers:view") ? getTodayAttendance(prisma, user) : null,
    hasPermission(user, "workers:view-pay") ? getMonthlyWorkerSummary(prisma, user, todayDateString().slice(0, 7)) : null,
  ]);

  const STATS: Stat[] = [
    {
      key: "active-orders",
      label: "الأوردرات الجارية",
      icon: PackageCheck,
      value: formatNumber(stats.activeOrders),
      note: stats.overdueOrders > 0 ? `${formatNumber(stats.overdueOrders)} متأخر` : undefined,
      alert: stats.overdueOrders > 0,
      href: stats.overdueOrders > 0 ? "/orders?status=overdue" : "/orders?status=open",
    },
    {
      key: "deliveries",
      label: "تسليمات النهارده",
      icon: Truck,
      value: formatNumber(production.deliveriesToday),
      // Quantities per unit — never one total across pieces and meters.
      note:
        production.deliveredThisMonth.length > 0
          ? `الشهر ده: ${production.deliveredThisMonth.map((d) => `${formatNumber(d.qty)} ${UNIT_LABELS[d.unit]}`).join(" · ")}`
          : "مفيش تسليم الشهر ده لسه",
    },
    {
      key: "completed",
      label: "أوردرات خلصت الشهر ده",
      icon: CheckCircle2,
      value: formatNumber(production.completedThisMonth),
      href: "/orders?status=COMPLETED",
    },
  ];
  if (stats.overdueOrders > 0) {
    STATS.push({
      key: "overdue",
      label: "أوردرات متأخرة",
      icon: AlarmClock,
      value: formatNumber(stats.overdueOrders),
      alert: true,
      note: "عدّى ميعاد تسليمها",
      href: "/orders?status=overdue",
    });
  }
  if (attendance) {
    STATS.push({
      key: "attendance",
      label: "العمال النهارده",
      icon: HardHat,
      value: `${formatNumber(attendance.presentToday)} من ${formatNumber(attendance.activeWorkers)}`,
      note: "حضروا",
      href: "/workers",
    });
  }
  if (stats.paymentsThisMonth !== null) {
    STATS.push({ key: "customer-payments", label: "مدفوعات العملاء (الشهر ده)", icon: Banknote, value: formatMoneyString(stats.paymentsThisMonth) });
  }
  if (workersMonth) {
    STATS.push({
      key: "wages",
      label: "يوميات العمال الشهر ده",
      icon: HardHat,
      value: formatMoneyString(workersMonth.expense.wagesEarned),
      note: `لسه ليهم ${formatMoneyString(workersMonth.balances.owedToWorkers)}`,
      href: "/workers/summary",
    });
  }
  if (finance) {
    STATS.push(
      {
        key: "expenses",
        label: "مصاريف الشهر ده",
        icon: Receipt,
        value: formatMoneyString(finance.expensesThisMonth),
        note: `اتدفع منها ${formatMoneyString(finance.expensesPaidThisMonth)}`,
        href: "/expenses",
      },
      {
        key: "paid-out",
        label: "فلوس اتدفعت الشهر ده",
        icon: Wallet,
        value: formatMoneyString(finance.paidOutThisMonth),
        note: "للموردين والمصاريف والعمال",
      },
      { key: "suppliers-owed", label: "لسه علينا للموردين", icon: Truck, value: formatMoneyString(finance.supplierOutstanding), href: "/suppliers" },
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">
          {greetingAr(new Date())}، {firstName} 👋
        </h1>
        <p className="mt-1.5 text-[0.95rem] leading-relaxed text-muted-foreground">
          أهلًا بك في Benuuprint. من هنا ستتابع الأوردرات والتسليمات والحسابات في مكان واحد.
        </p>
      </section>

      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          ملخص
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {STATS.map(({ key, label, icon: Icon, value, note, href, alert }) => {
            const body = (
              <>
                <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm text-muted-foreground">{label}</p>
                {value !== undefined ? (
                  <p className="mt-0.5 text-xl font-bold sm:text-2xl">{value}</p>
                ) : (
                  <p className="mt-0.5 text-2xl font-bold text-foreground/70" aria-label={`${label}: غير متاح بعد`}>
                    —
                  </p>
                )}
                {note && <p className={cn("mt-0.5 text-xs", alert ? "font-semibold text-destructive" : "text-muted-foreground")}>{note}</p>}
              </>
            );
            return (
              <li key={key}>
                {href ? (
                  <Link href={href} className="block h-full rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 active:bg-muted">
                    {body}
                  </Link>
                ) : (
                  <div className="h-full rounded-2xl border bg-card p-4">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          الكميات معروضة بوحداتها (قطعة، متر…) ومش بتتجمع مع بعض. الربح النهائي مش بيتحسب لسه — هييجي في مرحلة الحسابات.
        </p>
      </section>

      <section aria-labelledby="quick-heading">
        <h2 id="quick-heading" className="mb-3 text-lg font-bold">
          اختصارات سريعة
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            const content = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={cn(
                      "flex size-11 items-center justify-center rounded-xl",
                      action.href ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  {!action.href && <SoonBadge />}
                </div>
                <p className="mt-3 font-semibold">{action.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{action.description}</p>
              </>
            );
            return (
              <li key={action.key}>
                {action.href ? (
                  <Link
                    href={action.href}
                    className="block h-full rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 active:bg-muted"
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    aria-disabled="true"
                    className="h-full rounded-2xl border border-dashed bg-card/60 p-4 text-foreground/80"
                  >
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
