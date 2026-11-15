import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CheckCircle2, ChevronLeft, Factory, HandCoins, Plus, ReceiptText, Truck, UserCheck, type LucideIcon } from "lucide-react";
import { AttentionCard, OrderCard, type AttentionKind } from "@/components/ds/order-cards";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { todayDateString } from "@/lib/dates";
import { prisma } from "@/lib/db/prisma";
import { greetingAr } from "@/lib/format";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { getFinanceDashboard } from "@/server/services/finance-summary-service";
import { getMonthlyWorkerSummary, getTodayAttendance } from "@/server/services/labor-service";
import type { OrderSummary } from "@/server/services/order-dto";
import { getDashboardOverview, getDashboardStats } from "@/server/services/order-service";
import { getProductionDashboard } from "@/server/services/production-service";

export const metadata: Metadata = { title: "الرئيسية" };

const TODAY = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Cairo" });

type QuickAction = { href: string; label: string; icon: LucideIcon; hue: string; glow: string };

/** Each daily action owns a hue; the same hue marks that kind of work everywhere. */
const HUES = {
  blue: { hue: "bg-blue", glow: "shadow-[0_8px_18px_-8px_rgb(47_107_234/0.7)]" },
  teal: { hue: "bg-teal", glow: "shadow-[0_8px_18px_-8px_rgb(18_165_148/0.7)]" },
  green: { hue: "bg-green", glow: "shadow-[0_8px_18px_-8px_rgb(34_160_90/0.7)]" },
  amber: { hue: "bg-amber", glow: "shadow-[0_8px_18px_-8px_rgb(232_150_12/0.7)]" },
  rose: { hue: "bg-rose", glow: "shadow-[0_8px_18px_-8px_rgb(224_69_123/0.7)]" },
};

function SectionTitle({ id, children, action }: { id: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="font-display text-[1.15rem] font-semibold tracking-[-0.01em]">
        {children}
      </h2>
      {action}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.name.trim().split(/\s+/)[0];
  const canSeeMoney = hasPermission(user, "finance:view-summary");
  const showOrderMoney = hasPermission(user, "payments:record");
  const canCreate = hasPermission(user, "orders:create");
  const [stats, overview, production, finance, attendance, workersMonth] = await Promise.all([
    getDashboardStats(prisma, user),
    getDashboardOverview(prisma, user),
    getProductionDashboard(prisma, user),
    canSeeMoney ? getFinanceDashboard(prisma, user) : null,
    hasPermission(user, "workers:view") ? getTodayAttendance(prisma, user) : null,
    hasPermission(user, "workers:view-pay") ? getMonthlyWorkerSummary(prisma, user, todayDateString().slice(0, 7)) : null,
  ]);

  const actions = [
    hasPermission(user, "production:record") && { href: "/orders/pick?action=production", label: "تسجيل إنتاج", icon: Factory, ...HUES.blue },
    hasPermission(user, "deliveries:record") && { href: "/orders/pick?action=delivery", label: "تسليم قطع", icon: Truck, ...HUES.teal },
    hasPermission(user, "payments:record") && { href: "/orders/pick?action=payment", label: "تحصيل دفعة", icon: HandCoins, ...HUES.green },
    hasPermission(user, "expenses:record") && { href: "/expenses/new", label: "تسجيل مصروف", icon: ReceiptText, ...HUES.amber },
    hasPermission(user, "work:record") && hasPermission(user, "workers:view") && { href: "/workers", label: "حضور العمال", icon: UserCheck, ...HUES.rose },
  ].filter(Boolean) as QuickAction[];

  // Needs attention: overdue first, then due within three days, then finished pieces still with us.
  const seen = new Set<string>();
  const attention: { order: OrderSummary; kind: AttentionKind }[] = [];
  for (const o of overview.attention) {
    seen.add(o.id);
    attention.push({ order: o, kind: o.overdue ? "late" : "soon" });
  }
  for (const o of overview.readyWaiting) if (!seen.has(o.id)) attention.push({ order: o, kind: "ready" });

  const { newCount, inProgressCount, readyToDeliverCount } = overview;
  const anyOrders = overview.recent.length > 0;
  const pulse = [
    { n: newCount, label: "أوردر جديد", href: "/orders?status=NEW" },
    { n: inProgressCount, label: "تحت التنفيذ", href: "/orders?status=IN_PROGRESS" },
    { n: readyToDeliverCount, label: "جاهز للتسليم", href: "/orders?status=open" },
  ];

  return (
    <div className={cn("lg:grid lg:items-start lg:gap-8", finance && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
      <div className="min-w-0 space-y-7">
        {/* Zone A — the brand stage */}
        <section aria-labelledby="hello" className="stage animate-settle relative overflow-hidden rounded-[1.9rem] p-5 text-white shadow-[var(--shadow-violet)] sm:p-6">
          <span aria-hidden="true" className="pointer-events-none absolute -top-16 -end-12 size-48 rounded-full bg-[#ff7aa8]/25 blur-3xl" />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 start-6 size-44 rounded-full bg-[#4fc3f7]/20 blur-3xl" />
          <div className="relative">
            <p className="text-sm text-white/70">{TODAY.format(new Date())}</p>
            <h1 id="hello" className="mt-1 font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
              {greetingAr(new Date())} يا {firstName}
            </h1>

            {anyOrders ? (
              <ul className="mt-5 grid grid-cols-3 gap-2">
                {pulse.map((p) => (
                  <li key={p.label}>
                    <Link
                      href={p.href}
                      className="flex h-full flex-col rounded-2xl bg-white/10 px-3 py-3 ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/15"
                    >
                      <span className="tabular font-display text-[1.9rem] leading-none font-semibold">{formatNumber(p.n)}</span>
                      <span className="mt-1.5 text-xs leading-tight text-white/80">{p.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 max-w-[30ch] text-[0.95rem] leading-relaxed text-white/80">مفيش أوردرات لسه. أول أوردر تسجله هيظهر هنا بحالته وتقدّمه.</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {stats.overdueOrders > 0 && (
                <Link href="/orders?status=overdue" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-red px-3 font-semibold text-white shadow-[0_6px_16px_-6px_rgb(220_59_59/0.8)]">
                  <AlarmClock className="size-3.5" aria-hidden="true" />
                  {formatNumber(stats.overdueOrders)} متأخر
                </Link>
              )}
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-white/85 ring-1 ring-white/15">
                تسليمات النهارده <b className="tabular font-semibold text-white">{formatNumber(production.deliveriesToday)}</b>
              </span>
              {production.deliveredThisMonth.map((d) => (
                <span key={d.unit} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-white/85 ring-1 ring-white/15">
                  اتسلم الشهر ده <b className="tabular font-semibold text-white">{formatNumber(d.qty)}</b> {UNIT_LABELS[d.unit]}
                </span>
              ))}
              {attendance && (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-white/85 ring-1 ring-white/15">
                  حضر <b className="tabular font-semibold text-white">{formatNumber(attendance.presentToday)}</b> من {formatNumber(attendance.activeWorkers)}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Zone B — quick actions */}
        {(canCreate || actions.length > 0) && (
          <section aria-labelledby="quick-heading">
            <SectionTitle id="quick-heading">إجراءات سريعة</SectionTitle>
            <ul className="grid grid-cols-3 gap-2.5">
              {canCreate && (
                <li>
                  <Link
                    href="/orders/new"
                    className="flex h-[6.75rem] flex-col justify-between rounded-[1.4rem] bg-gradient-to-br from-[#6d47ea] to-violet-deep p-3 text-white shadow-[var(--shadow-violet)] transition-transform duration-150 active:scale-[0.96] md:h-[4.5rem] md:flex-row md:items-center md:justify-start md:gap-3"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
                      <Plus className="size-6" strokeWidth={2.5} aria-hidden="true" />
                    </span>
                    <span className="font-display text-[0.88rem] leading-snug font-semibold">أوردر جديد</span>
                  </Link>
                </li>
              )}
              {actions.map((a) => (
                <li key={a.href}>
                  <Link
                    href={a.href}
                    className="flex h-[6.75rem] flex-col justify-between rounded-[1.4rem] bg-surface p-3 shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-150 hover:shadow-[var(--shadow-lift)] active:scale-[0.96] md:h-[4.5rem] md:flex-row md:items-center md:justify-start md:gap-3"
                  >
                    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-white", a.hue, a.glow)}>
                      <a.icon className="size-5" strokeWidth={2.1} aria-hidden="true" />
                    </span>
                    <span className="font-display text-[0.88rem] leading-snug font-semibold">{a.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Zone C — needs attention */}
        <section aria-labelledby="attention-heading">
          <SectionTitle id="attention-heading">محتاج انتباهك</SectionTitle>
          {attention.length === 0 ? (
            <p className="flex items-center gap-2.5 rounded-[1.4rem] bg-green-soft px-4 py-3.5 text-sm font-semibold text-green-ink">
              <CheckCircle2 className="size-5 shrink-0 text-green" aria-hidden="true" />
              مفيش حاجة متأخرة أو مستعجلة دلوقتي.
            </p>
          ) : (
            <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
              {attention.map((a) => (
                <AttentionCard key={a.order.id} order={a.order} kind={a.kind} />
              ))}
            </ul>
          )}
        </section>

        {/* Zone D — recent orders */}
        <section aria-labelledby="recent-heading">
          <SectionTitle
            id="recent-heading"
            action={
              anyOrders && (
                <Link href="/orders" className="inline-flex h-9 items-center gap-0.5 rounded-full px-3 text-sm font-semibold text-violet hover:bg-violet-soft">
                  كل الأوردرات
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Link>
              )
            }
          >
            آخر الأوردرات
          </SectionTitle>
          {anyOrders ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {overview.recent.map((o) => (
                <OrderCard key={o.id} order={o} showMoney={showOrderMoney} />
              ))}
            </ul>
          ) : (
            <div className="rounded-[1.6rem] border-2 border-dashed border-[#d9d2ea] bg-surface/60 px-5 py-8 text-center">
              <p className="font-display text-lg font-semibold">لسه مفيش أوردرات</p>
              <p className="mx-auto mt-1 max-w-[32ch] text-sm leading-relaxed text-graphite">كل أوردر هيظهر هنا بالعميل والميعاد وكام قطعة اتسلمت.</p>
              {canCreate && (
                <Link
                  href="/orders/new"
                  className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-violet px-5 text-sm font-semibold text-white shadow-[var(--shadow-violet)]"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  سجّل أول أوردر
                </Link>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Owner: this month's money */}
      {finance && (
        <aside aria-labelledby="money-heading" className="mt-7 lg:sticky lg:top-20 lg:mt-0">
          <section className="relative overflow-hidden rounded-[1.6rem] bg-ink p-5 text-white shadow-[var(--shadow-lift)]">
            <span aria-hidden="true" className="pointer-events-none absolute -top-14 -start-10 size-40 rounded-full bg-green/25 blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <h2 id="money-heading" className="text-sm font-semibold text-white/75">
                  فلوس الشهر ده
                </h2>
                <Link href="/accounts" className="inline-flex h-8 items-center gap-0.5 rounded-full bg-white/10 px-3 text-xs font-semibold hover:bg-white/15">
                  الحسابات
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
              <dl>
                <div className="mt-3">
                  <dt className="text-xs text-white/60">اتحصّل من العملاء</dt>
                  <dd className="tabular mt-0.5 font-display text-[1.9rem] leading-tight font-semibold text-[#7ee2a8]">
                    {formatMoneyString(stats.paymentsThisMonth ?? "0")}
                  </dd>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    { label: "مصاريف الشهر", value: finance.expensesThisMonth },
                    { label: "اتدفع الشهر ده", value: finance.paidOutThisMonth },
                    { label: "لسه للموردين", value: finance.supplierOutstanding },
                    ...(workersMonth ? [{ label: "لسه للعمال", value: workersMonth.balances.owedToWorkers }] : []),
                  ].map((m) => (
                    <div key={m.label} className="rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
                      <dt className="text-[0.7rem] text-white/60">{m.label}</dt>
                      <dd className="tabular mt-0.5 font-display text-[0.95rem] font-semibold">{formatMoneyString(m.value)}</dd>
                    </div>
                  ))}
                </div>
              </dl>
              <p className="mt-3 text-[0.7rem] leading-relaxed text-white/50">من السجلات الفعلية. الربح النهائي هيتحسب مع مرحلة الحسابات.</p>
            </div>
          </section>
        </aside>
      )}
    </div>
  );
}
