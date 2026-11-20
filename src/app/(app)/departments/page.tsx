import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, CircleAlert, Info, Layers, Scale, Settings2 } from "lucide-react";
import { EmptyState, FlowCard } from "@/components/ds/primitives";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/current-user";
import { isOwner } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { cn } from "@/lib/utils";
import { getDepartmentsOverview, listMyDepartments } from "@/server/services/department-service";

export const metadata: Metadata = { title: "الأقسام" };

/**
 * «الأقسام». The owner gets the consolidated overview of every department;
 * anyone else (partner or staff member) only the departments they belong to —
 * straight into it when there is only one.
 */
export default async function DepartmentsPage() {
  const user = await requireUser();
  if (!isOwner(user)) {
    const mine = await listMyDepartments(prisma, user);
    if (mine.length === 1) redirect(`/departments/${mine[0]!.departmentId}`);
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="الأقسام" subtitle="الأقسام اللي حسابك يقدر يشوف شغلها" />
        {mine.length === 0 ? (
          <EmptyState icon={Layers} title="مفيش أقسام متاحة لحسابك">
            المدير لسه محددلكش قسم، أو الصلاحية اتشالت. كلّمه يحدد لك القسم اللي بتشتغل فيه.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {mine.map((d) => (
              <li key={d.departmentId}>
                <Link href={`/departments/${d.departmentId}`} className="flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-line-strong">
                  <span className="flex items-center gap-3 font-display text-lg font-semibold">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-violet-soft text-violet">
                      <Layers className="size-5" aria-hidden="true" />
                    </span>
                    {d.name}
                  </span>
                  <ChevronLeft className="size-5 text-graphite" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const overview = await getDepartmentsOverview(prisma, user);
  const unassignedItems = overview.unassigned.items.total;
  return (
    <div className="space-y-5">
      <PageHeader
        title="الأقسام"
        subtitle="شغل كل قسم وقيمته — كل بند بيتحسب لقسم واحد بس"
        action={
          <Link href="/departments/manage" className={buttonVariants({ variant: "outline", className: "shrink-0" })}>
            <Settings2 className="size-4" aria-hidden="true" />
            إدارة الأقسام
          </Link>
        }
      />

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {overview.departments.map((d) => (
          <li key={d.id}>
            <Link
              href={`/departments/${d.id}`}
              className={cn("flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong", !d.isActive && "opacity-70")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-soft text-violet">
                    <Layers className="size-[1.1rem]" aria-hidden="true" />
                  </span>
                  <span className="truncate font-display text-[1.05rem] font-semibold">{d.name}</span>
                </span>
                {!d.isActive && <span className="shrink-0 rounded-full bg-well px-2 py-0.5 text-xs text-graphite ring-1 ring-hairline">متوقف</span>}
              </div>
              <dl className="grid grid-cols-3 gap-1 rounded-xl bg-well py-2 text-center">
                <div>
                  <dt className="text-[0.68rem] text-graphite">أوردرات</dt>
                  <dd className="tabular font-display font-semibold">{formatNumber(d.stats.orders.total)}</dd>
                </div>
                <div className="border-x border-hairline">
                  <dt className="text-[0.68rem] text-graphite">شغّال</dt>
                  <dd className="tabular font-display font-semibold">{formatNumber(d.stats.orders.active)}</dd>
                </div>
                <div>
                  <dt className="text-[0.68rem] text-graphite">قطع فاضلة</dt>
                  <dd className="tabular font-display font-semibold">{formatNumber(d.stats.pendingPieces)}</dd>
                </div>
              </dl>
              <dl className="mt-auto space-y-1 text-sm">
                <div className="flex items-baseline justify-between">
                  <dt className="text-graphite">قيمة الشغل</dt>
                  <dd className="tabular font-display font-semibold">{formatMoneyString(d.stats.money.workValue)}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-graphite">تحصيل موزّع</dt>
                  <dd className="tabular font-semibold text-success-ink">{formatMoneyString(d.stats.money.collections!.collected)}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-graphite">متبقي</dt>
                  <dd className="tabular font-semibold">{formatMoneyString(d.stats.money.collections!.outstanding)}</dd>
                </div>
              </dl>
              <p className="text-xs text-graphite">{d.members > 0 ? `${formatNumber(d.members)} حساب ليه دخول` : "مفيش حد ليه دخول غير المدير"}</p>
            </Link>
          </li>
        ))}
      </ul>

      {unassignedItems > 0 && (
        <p className="flex items-start gap-2 rounded-2xl bg-warning-soft p-3.5 text-sm text-warning-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          في {formatNumber(unassignedItems)} بند من غير قسم. افتح الأوردر وعدّله واختار القسم لكل بند.
        </p>
      )}

      <FlowCard title="مراجعة إن مفيش حاجة بتتحسب مرتين" icon={Scale}>
        <dl className="divide-y divide-hairline rounded-2xl bg-well px-4 text-sm">
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-graphite">مجموع قيم شغل الأقسام</dt>
            <dd className="tabular font-semibold">{formatMoneyString(overview.totals.departmentsValue)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-graphite">غير موزّع (بنود من غير قسم أو سعر، أو تقسيم قديم)</dt>
            <dd className="tabular font-semibold">{formatMoneyString(overview.unallocated.value)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="font-semibold">إجمالي الأوردرات (غير الملغية)</dt>
            <dd className="tabular font-semibold">{formatMoneyString(overview.totals.ordersTotal)}</dd>
          </div>
        </dl>
        <p className={cn("mt-2 text-sm font-semibold", overview.totals.valueBalanced ? "text-success-ink" : "text-danger-ink")} data-testid="departments-value-balanced">
          {overview.totals.valueBalanced ? "القيم متطابقة ✓ — كل بند محسوب مرة واحدة بس." : "القيم مش متطابقة — راجع البنود."}
        </p>

        <dl className="mt-4 divide-y divide-hairline rounded-2xl bg-well px-4 text-sm">
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-graphite">مجموع التحصيل الموزّع على الأقسام</dt>
            <dd className="tabular font-semibold">{formatMoneyString(overview.totals.departmentsCollected)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-graphite">تحصيل غير موزّع</dt>
            <dd className="tabular font-semibold">{formatMoneyString(overview.unallocated.collected)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="font-semibold">إجمالي دفعات العملاء الصحيحة</dt>
            <dd className="tabular font-semibold">{formatMoneyString(overview.totals.paymentsTotal)}</dd>
          </div>
        </dl>
        <p className={cn("mt-2 text-sm font-semibold", overview.totals.collectionsBalanced ? "text-success-ink" : "text-danger-ink")} data-testid="departments-collections-balanced">
          {overview.totals.collectionsBalanced ? "التحصيل متطابق ✓ — كل جنيه اتحسب مرة واحدة." : "التحصيل مش متطابق."}
        </p>
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-graphite">
          <Info className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden="true" />
          التحصيل الموزّع محسوب بالنسبة لكل دفعة حسب قيمة شغل كل قسم في الأوردر (بالقرش، والفكة بتروح لأكبر باقي). ده عرض حسابي بس: الدفعات نفسها والخزنة زي ما هم، ومفيش حاجة بتتدفع للشركاء تلقائي. الأوردرات القديمة بسعر إجمالي واحد بتفضل «غير موزّع».
        </p>
      </FlowCard>
    </div>
  );
}
