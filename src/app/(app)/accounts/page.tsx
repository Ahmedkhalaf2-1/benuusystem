import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  ChevronLeft,
  ClipboardList,
  HardHat,
  History,
  Receipt,
  Truck,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Hue } from "@/components/ds/primitives";
import { Flash } from "@/components/flash";
import { Caveat, egp, PeriodPicker, withPeriod } from "@/components/reports/report-ui";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { toCents } from "@/lib/money";
import { parsePeriod } from "@/lib/reports/period";
import { cn } from "@/lib/utils";
import { getFinancialOverview } from "@/server/services/reports-service";

export const metadata: Metadata = { title: "الحسابات" };

function ReportRow({ href, label, note, icon: Icon }: { href: string; label: string; note: string; icon: LucideIcon; hue?: Hue }) {
  return (
    <li>
      <Link href={href} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-well">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display font-semibold">{label}</span>
          <span className="tabular block truncate text-xs text-graphite">{note}</span>
        </span>
        <ChevronLeft className="size-4 shrink-0 text-graphite" aria-hidden="true" />
      </Link>
    </li>
  );
}

function BalanceCard({ href, title, tone, value, testId, children, wide }: { href: string; title: string; tone: string; value: string; testId: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <Link href={href} className={cn("rounded-2xl bg-surface p-4 border border-line transition-shadow hover:border-line-strong", wide && "sm:col-span-2")}>
      <p className={cn("flex items-center justify-between text-sm font-semibold", tone)}>
        {title}
        <ChevronLeft className="size-4 text-graphite" aria-hidden="true" />
      </p>
      <p className="tabular mt-1 font-display text-[1.75rem] leading-tight font-semibold" data-testid={testId}>
        {egp(value)}
      </p>
      {children && <div className="mt-1 text-xs text-graphite">{children}</div>}
    </Link>
  );
}

/** Money hub. Owner: the five questions answered from recorded events. Staff: where to record. */
export default async function AccountsPage(props: PageProps<"/accounts">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const isOwner = hasPermission(user, "finance:reports");
  const period = parsePeriod(sp);
  const o = isOwner ? await getFinancialOverview(prisma, user, period) : null;

  const staffLinks = [
    hasPermission(user, "customers:view") && { href: "/customers", label: "العملاء", note: "بيانات العملاء ومدفوعاتهم", icon: UsersRound, hue: "violet" as Hue },
    hasPermission(user, "suppliers:view") && { href: "/suppliers", label: "الموردين", note: "المشتريات والدفعات", icon: Truck, hue: "blue" as Hue },
  ].filter(Boolean) as { href: string; label: string; note: string; icon: LucideIcon; hue: Hue }[];

  return (
    <div className="space-y-6">
      <Flash message={sp.saved === "expense" ? "تم حفظ المصروف ✓" : undefined} />
      <h1 className="font-display text-[1.75rem] leading-[1.35] font-semibold tracking-[-0.02em]">الحسابات</h1>

      {o && (
        <>
          <PeriodPicker period={period} basePath="/accounts" />

          {/* 1–2: what came in and went out — actual cash only */}
          <section aria-label="حركة الفلوس" className="relative overflow-hidden rounded-2xl bg-panel p-5 text-on-panel border border-line">
            <div className="relative">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-on-panel-muted">حركة الفلوس الفعلية</h2>
                <Link href={withPeriod("/accounts/cash-flow", period)} className="inline-flex h-8 items-center gap-0.5 rounded-full bg-panel-2 px-3 text-xs font-semibold hover:bg-panel-line">
                  التفاصيل
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-panel-2 p-3 ring-1 ring-panel-line">
                  <dt className="flex items-center gap-1.5 text-xs text-on-panel-muted">
                    <ArrowDownLeft className="size-3.5 text-panel-success" aria-hidden="true" />
                    الفلوس اللي دخلت
                  </dt>
                  <dd className="tabular mt-1 font-display text-xl font-semibold text-panel-success" data-testid="cash-in">
                    {egp(o.cash.in)}
                  </dd>
                </div>
                <div className="rounded-2xl bg-panel-2 p-3 ring-1 ring-panel-line">
                  <dt className="flex items-center gap-1.5 text-xs text-on-panel-muted">
                    <ArrowUpRight className="size-3.5 text-on-panel" aria-hidden="true" />
                    الفلوس اللي خرجت
                  </dt>
                  <dd className="tabular mt-1 font-display text-xl font-semibold text-on-panel" data-testid="cash-out">
                    {egp(o.cash.out)}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-panel-2 px-3.5 py-3 ring-1 ring-panel-line">
                <span className="text-sm text-on-panel-muted">صافي حركة الفلوس</span>
                <span className={cn("tabular font-display text-2xl font-semibold", toCents(o.cash.net) < 0n ? "text-on-panel" : "text-white")} data-testid="cash-net">
                  {egp(o.cash.net)}
                </span>
              </div>
              <p className="mt-2 text-[0.7rem] leading-relaxed text-on-panel-muted">ده الفرق بين اللي دخل واللي خرج فعلًا في الفترة — مش الربح، ومش رصيد الخزنة.</p>
            </div>
          </section>

          {/* 3–4: who owes whom, right now */}
          <section aria-labelledby="balances-heading">
            <h2 id="balances-heading" className="mb-3 font-display text-[1.15rem] font-semibold">
              فلوس لسه متسوّتش (لحد النهارده)
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <BalanceCard href="/accounts/receivables" title="لينا عند العملاء" tone="text-graphite" value={o.receivables.total} testId="receivables-total">
                على {o.receivables.orders} أوردر
                {toCents(o.receivables.overdue) > 0n && <span className="font-semibold text-red"> · منها {egp(o.receivables.overdue)} متأخر</span>}
              </BalanceCard>
              <BalanceCard href="/accounts/payables" title="علينا للموردين والمصاريف" tone="text-graphite" value={o.payables.total} testId="payables-total">
                موردين {egp(o.payables.suppliers)} · مصاريف {egp(o.payables.expenses)}
                {toCents(o.payables.looseCosts) > 0n && <> · تكاليف من غير مورد {egp(o.payables.looseCosts)}</>}
              </BalanceCard>
              <BalanceCard href="/accounts/workers" title="مستحقات العمال" tone="text-graphite" value={o.workers.owed} testId="workers-owed" wide>
                {toCents(o.workers.advancesOutstanding) > 0n ? <span className="text-amber-ink">وفيه سلف لسه متخصمتش {egp(o.workers.advancesOutstanding)}</span> : "اليوميات اللي اتكسبت ولسه متدفعتش"}
              </BalanceCard>
            </div>
            {o.receivables.needsDecision > 0 && (
              <div className="mt-3">
                <Caveat tone="warn">
                  في {o.receivables.needsDecision} أوردر عليه فلوس مش واضح مصيرها (ملغي واتدفع عليه، أو مدفوع أكتر من سعره).{" "}
                  <Link href="/accounts/receivables#needs-decision" className="font-semibold underline">
                    شوفهم
                  </Link>
                </Caveat>
              </div>
            )}
            {toCents(o.labor.unallocated) > 0n && (
              <div className="mt-3">
                <Caveat>
                  يوميات بـ {egp(o.labor.unallocated)} في الفترة دي مش متوزعة على أوردرات (مفيش شغل متسجل). بتتحسب في أجور العمال، بس مش داخلة في هامش أي أوردر.
                </Caveat>
              </div>
            )}
          </section>

          {/* Reports */}
          <section aria-labelledby="reports-heading">
            <h2 id="reports-heading" className="mb-3 font-display text-[1.15rem] font-semibold">
              التقارير
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface md:grid md:grid-cols-2 md:divide-y-0">
              <ReportRow href={withPeriod("/accounts/cash-flow", period)} label="حركة الفلوس" note="الداخل والخارج بالتفصيل" icon={Wallet} hue="green" />
              <ReportRow href={withPeriod("/accounts/movements", period)} label="كل الحركات" note="كل دفعة دخلت أو خرجت" icon={History} hue="violet" />
              <ReportRow href="/accounts/receivables" label="العملاء اللي عليهم فلوس" note={egp(o.receivables.total)} icon={Banknote} hue="green" />
              <ReportRow href="/accounts/payables" label="حسابات الموردين" note={egp(o.payables.suppliers)} icon={Truck} hue="blue" />
              <ReportRow href="/accounts/workers" label="أجور العمال" note={`اتكسب في الفترة ${egp(o.labor.earned)}`} icon={HardHat} hue="rose" />
              <ReportRow href="/accounts/orders" label="تكاليف وهامش الأوردرات" note="قبل المصاريف العامة" icon={ClipboardList} hue="violet" />
              <ReportRow href={withPeriod("/accounts/expenses", period)} label="المصاريف" note={`اتسجل ${egp(o.expenses.incurred)}`} icon={Receipt} hue="amber" />
            </ul>
          </section>
        </>
      )}

      {hasPermission(user, "expenses:record") && (
        <Link
          href="/expenses/new"
          className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand-solid font-display text-lg font-semibold text-white transition-transform active:scale-[0.98]"
        >
          <Receipt className="size-5" aria-hidden="true" />
          سجل مصروف
        </Link>
      )}

      {!o && staffLinks.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {staffLinks.map((l) => (
            <ReportRow key={l.href} {...l} />
          ))}
        </ul>
      )}
      <p className="text-xs text-graphite">تكلفة كل أوردر بتتسجل من صفحة الأوردر نفسه («إضافة تكلفة»).</p>
    </div>
  );
}
