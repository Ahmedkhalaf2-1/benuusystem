import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr, todayDateString } from "@/lib/dates";
import { formatMoneyString, toCents } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { cn } from "@/lib/utils";
import { getMonthlyWorkerSummary } from "@/server/services/labor-service";

export const metadata: Metadata = { title: "حساب العمال" };

function Card({ label, value, tone, testid }: { label: string; value: string; tone?: string; testid?: string }) {
  return (
    <div className={cn("rounded-xl p-3", tone ?? "bg-well")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-nowrap text-lg font-bold" data-testid={testid}>
        {value}
      </p>
    </div>
  );
}

export default async function WorkersSummaryPage(props: PageProps<"/workers/summary">) {
  const user = await requirePermission("workers:view-pay");
  const { month: m } = await props.searchParams;
  const month = typeof m === "string" && /^\d{4}-\d{2}$/.test(m) ? m : todayDateString().slice(0, 7);
  const s = await getMonthlyWorkerSummary(prisma, user, month);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="حساب العمال" backHref="/workers" backLabel="العمال" subtitle={`من ${formatDateAr(s.from)} لحد ${formatDateAr(s.to)}`} />
      <form action="/workers/summary" method="get" className="flex gap-2">
        <Input type="month" name="month" defaultValue={month} className="flex-1" aria-label="الشهر" />
        <Button type="submit" variant="outline" className="h-12">
          عرض
        </Button>
      </form>

      <section className="rounded-2xl bg-surface border border-line p-4">
        <h2 className="font-display text-[1.05rem] font-semibold">1. شغل الشهر ده كلّف كام؟</h2>
        <p className="mb-3 text-xs text-muted-foreground">اليوميات اللي اتكسبت في أيام الشهر ده (حتى لو لسه متدفعتش).</p>
        <div className="grid grid-cols-2 gap-2">
          <Card label="عدد العمال" value={formatNumber(s.expense.workersCount)} />
          <Card label="أيام الشغل" value={formatNumber(s.expense.workedDays)} />
          <Card label="اليوميات المستحقة" value={formatMoneyString(s.expense.wagesEarned)} tone="bg-brand-soft" testid="sum-earned" />
          <Card label="يوميات مش متوزعة على أوردرات" value={formatMoneyString(s.expense.unallocatedLabor)} tone="bg-amber-soft" testid="sum-unallocated" />
        </div>
      </section>

      <section className="rounded-2xl bg-surface border border-line p-4">
        <h2 className="font-display text-[1.05rem] font-semibold">2. اتدفع للعمال كام في الشهر ده؟</h2>
        <p className="mb-3 text-xs text-muted-foreground">الفلوس اللي خرجت فعلًا في الشهر ده (حتى لو كانت عن شغل شهر قبله).</p>
        <div className="grid grid-cols-3 gap-2">
          <Card label="يوميات" value={formatMoneyString(s.cash.wagePayments)} tone="bg-green-soft" testid="sum-wage-paid" />
          <Card label="سلف" value={formatMoneyString(s.cash.advances)} tone="bg-amber-soft" testid="sum-advances" />
          <Card label="الإجمالي" value={formatMoneyString(s.cash.total)} />
        </div>
      </section>

      <section className="rounded-2xl bg-surface border border-line p-4">
        <h2 className="font-display text-[1.05rem] font-semibold">3. الحساب في آخر الشهر</h2>
        <p className="mb-3 text-xs text-muted-foreground">لحد {formatDateAr(s.to)}.</p>
        <div className="grid grid-cols-2 gap-2">
          <Card label="لسه ليهم" value={formatMoneyString(s.balances.owedToWorkers)} tone="bg-brand-soft" testid="sum-owed" />
          <Card label="سلف لسه متخصمتش" value={formatMoneyString(s.balances.advancesOutstanding)} tone="bg-amber-soft" />
        </div>
      </section>

      <section className="rounded-2xl bg-surface border border-line p-4">
        <h2 className="mb-2 font-display text-[1.05rem] font-semibold">كل عامل</h2>
        {s.workers.length === 0 ? (
          <p className="text-sm text-muted-foreground">مفيش عمال.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {s.workers.map((w) => {
              const bal = toCents(w.balanceAtEnd);
              return (
                <li key={w.id}>
                  <Link href={`/workers/${w.id}`} className="block py-3 hover:bg-well">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {w.name}
                          {!w.isActive && <span className="text-xs text-muted-foreground"> · موقوف</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(w.workedDays)} يوم · اتكسب {formatMoneyString(w.earned)} · اتدفع له {formatMoneyString(w.paidInMonth)}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="text-[0.7rem] text-muted-foreground">{bal >= 0n ? "لسه له" : "عليه سلفة"}</p>
                        <p className={cn("whitespace-nowrap font-bold", bal >= 0n ? "text-primary" : "text-amber-ink")}>
                          {formatMoneyString(bal >= 0n ? w.balanceAtEnd : w.balanceAtEnd.slice(1))}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        اليوميات دي هي تكلفة العمالة الوحيدة — متتسجلش تاني كمصروف عام ولا كتكلفة أوردر. الربح النهائي هيتحسب في مرحلة الحسابات.
      </p>
    </div>
  );
}
