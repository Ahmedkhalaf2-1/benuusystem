import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Wallet } from "lucide-react";
import { FlowCard, FlowHeader } from "@/components/ds/primitives";
import { CASH_LABELS, Caveat, egp, PeriodPicker, ShareRow, withPeriod } from "@/components/reports/report-ui";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { toCents } from "@/lib/money";
import { parsePeriod } from "@/lib/reports/period";
import { cn } from "@/lib/utils";
import { getCashFlow } from "@/server/services/reports-service";

export const metadata: Metadata = { title: "حركة الفلوس" };

const TONE = { customers: "bg-success-solid", costs: "bg-brand-solid", expenses: "bg-amber", wages: "bg-brand-solid", advances: "bg-brand-muted" } as const;
const KIND = { customers: "customer", costs: "cost", expenses: "expense", wages: "wage", advances: "advance" } as const;
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export default async function CashFlowPage(props: PageProps<"/accounts/cash-flow">) {
  const user = await requirePermission("finance:view-summary");
  const period = parsePeriod(await props.searchParams);
  const cf = await getCashFlow(prisma, user, period);
  const peak = cf.months.reduce((m, r) => [toCents(r.in), toCents(r.out), m].reduce((a, b) => (a > b ? a : b)), 0n);
  const h = (v: string) => (peak > 0n ? Number((toCents(v) * 1000n) / peak) / 10 : 0);
  const empty = toCents(cf.totalIn) === 0n && toCents(cf.totalOut) === 0n;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FlowHeader icon={Wallet} hue="green" title="حركة الفلوس" context="الفلوس اللي دخلت وخرجت فعلًا، بتاريخ الدفع" backHref="/accounts" backLabel="الحسابات" />
      <PeriodPicker period={period} basePath="/accounts/cash-flow" />

      <section className="grid grid-cols-3 gap-2 rounded-2xl bg-panel p-2 text-on-panel border border-line">
        {[
          { label: "إجمالي الداخل", value: cf.totalIn, tone: "text-panel-success", id: "cf-in" },
          { label: "إجمالي الخارج", value: cf.totalOut, tone: "text-on-panel", id: "cf-out" },
          { label: "صافي حركة الفلوس", value: cf.net, tone: toCents(cf.net) < 0n ? "text-on-panel" : "text-white", id: "cf-net" },
        ].map((m) => (
          <div key={m.id} className="rounded-2xl bg-panel-2 px-3 py-3 ring-1 ring-panel-line">
            <p className="text-[0.7rem] text-on-panel-muted">{m.label}</p>
            <p className={cn("tabular mt-1 font-display text-[1.05rem] font-semibold whitespace-nowrap sm:text-xl", m.tone)} data-testid={m.id}>
              {egp(m.value)}
            </p>
          </div>
        ))}
      </section>
      <Caveat>صافي حركة الفلوس = الداخل − الخارج في الفترة. مش ربح: التكلفة اللي اتسجلت ومتدفعتش مش هنا، والفلوس اللي لسه عند العملاء مش هنا.</Caveat>

      {empty ? (
        <p className="rounded-2xl bg-surface px-5 py-8 text-center text-sm text-graphite border border-line">مفيش فلوس دخلت أو خرجت في الفترة دي.</p>
      ) : (
        <>
          <FlowCard title="الداخل" icon={Wallet} hue="green">
            {cf.inflows.map((l) => (
              <ShareRow key={l.key} label={CASH_LABELS[l.key]} amount={l.total} count={l.count} share={l.share} tone={TONE[l.key]} href={withPeriod("/accounts/movements", period, { kind: KIND[l.key] })} />
            ))}
          </FlowCard>
          <FlowCard title="الخارج" icon={Wallet} hue="amber">
            <div className="divide-y divide-hairline">
              {cf.outflows.map((l) => (
                <ShareRow key={l.key} label={CASH_LABELS[l.key]} amount={l.total} count={l.count} share={l.share} tone={TONE[l.key]} href={withPeriod("/accounts/movements", period, { kind: KIND[l.key] })} />
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-graphite">السلفة فلوس خرجت بس مش تكلفة جديدة — لما العامل يشتغل بيها مفيش فلوس بتخرج تاني.</p>
          </FlowCard>
        </>
      )}

      <FlowCard title="آخر ٦ شهور">
        <div className="flex h-36 items-end gap-2" role="img" aria-label="الداخل والخارج في آخر ستة شهور">
          {cf.months.map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-28 w-full items-end justify-center gap-1">
                <span className="w-1/3 rounded-t-md bg-success-solid" style={{ height: `${h(m.in)}%` }} title={`دخل ${egp(m.in)}`} />
                <span className="w-1/3 rounded-t-md bg-amber" style={{ height: `${h(m.out)}%` }} title={`خرج ${egp(m.out)}`} />
              </div>
              <span className="text-[0.65rem] text-graphite">{MONTHS[Number(m.month.slice(5)) - 1]}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-graphite">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-success-solid" />داخل</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-amber" />خارج</span>
        </div>
      </FlowCard>

      <Link href={withPeriod("/accounts/movements", period)} className="flex h-13 items-center justify-between rounded-2xl bg-surface px-4 font-semibold border border-line hover:border-line-strong">
        كل الحركات في الفترة
        <ChevronLeft className="size-4 text-graphite" aria-hidden="true" />
      </Link>
    </div>
  );
}
