import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, PackageCheck, Receipt, Truck } from "lucide-react";
import { SoonBadge } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { greetingAr } from "@/lib/format";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { getDashboardStats } from "@/server/services/order-service";
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
  const stats = await getDashboardStats(prisma, user);
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
    { key: "deliveries", label: "التسليمات", icon: Truck, note: "قريبًا" },
    {
      key: "customer-payments",
      label: "مدفوعات العملاء (الشهر ده)",
      icon: Banknote,
      value: formatMoneyString(stats.paymentsThisMonth),
    },
    { key: "expenses", label: "المصروفات", icon: Receipt, note: "قريبًا" },
  ];

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
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          التسليمات والمصروفات هتظهر أرقامها لما الأقسام دي تتفعّل.
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
