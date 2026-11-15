import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Receipt } from "lucide-react";
import { FlowCard, FlowHeader } from "@/components/ds/primitives";
import { Caveat, egp, PeriodPicker, ShareRow, withPeriod } from "@/components/reports/report-ui";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/finance/labels";
import { parsePeriod } from "@/lib/reports/period";
import { getExpenseReport } from "@/server/services/reports-service";

export const metadata: Metadata = { title: "تقرير المصاريف" };

export default async function ExpenseReportPage(props: PageProps<"/accounts/expenses">) {
  const user = await requirePermission("finance:view-summary");
  const period = parsePeriod(await props.searchParams);
  const r = await getExpenseReport(prisma, user, period);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FlowHeader icon={Receipt} hue="amber" title="المصاريف العامة" context="إيجار، كهرباء، صيانة… من غير تكاليف الأوردرات" backHref="/accounts" backLabel="الحسابات" />
      <PeriodPicker period={period} basePath="/accounts/expenses" />
      <section className="grid grid-cols-3 gap-2 rounded-2xl bg-surface p-1.5 border border-line">
        <div className="rounded-2xl bg-amber-soft px-3 py-3">
          <p className="text-[0.7rem] font-semibold text-amber-ink">اتسجل في الفترة</p>
          <p className="tabular mt-1 font-display text-base font-semibold sm:text-lg" data-testid="exp-incurred">{egp(r.totalIncurred)}</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-[0.7rem] text-graphite">اتدفع في الفترة (كاش)</p>
          <p className="tabular mt-1 font-display text-base font-semibold text-green-ink sm:text-lg" data-testid="exp-paid">{egp(r.totalPaid)}</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-[0.7rem] text-graphite">لسه متدفعش آخر الفترة</p>
          <p className="tabular mt-1 font-display text-base font-semibold sm:text-lg">{egp(r.unpaidAtEnd)}</p>
        </div>
      </section>
      <Caveat>المصروف بيتحسب في الشهر اللي اتسجل فيه (تاريخ المصروف)، والدفع بيتحسب في الشهر اللي الفلوس خرجت فيه. مصروف اتسجل أكتوبر واتدفع نوفمبر = مصروف أكتوبر، وفلوس خارجة نوفمبر — مش مرتين.</Caveat>
      <FlowCard title="حسب النوع" icon={Receipt} hue="amber">
        {r.categories.length === 0 ? (
          <p className="text-sm text-graphite">مفيش مصاريف اتسجلت أو اتدفعت في الفترة دي.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {r.categories.map((c) => (
              <div key={c.category}>
                <ShareRow label={EXPENSE_CATEGORY_LABELS[c.category]} amount={c.incurred} count={c.count} share={c.share} tone="bg-amber" unit="مصروف" href={withPeriod("/expenses", period, { category: c.category })} />
                {c.paid !== "0.00" && <p className="-mt-1 px-1 pb-2 text-xs text-green-ink">اتدفع في الفترة {egp(c.paid)}</p>}
              </div>
            ))}
          </div>
        )}
      </FlowCard>
      <Link href={withPeriod("/expenses", period)} className="flex h-13 items-center justify-between rounded-2xl bg-surface px-4 font-semibold border border-line hover:border-line-strong">
        كل المصاريف بالتفصيل
        <ChevronLeft className="size-4 text-graphite" aria-hidden="true" />
      </Link>
    </div>
  );
}
