import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Info } from "lucide-react";
import { EmptyState } from "@/components/ds/primitives";
import { NativeSelect } from "@/components/forms/field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr, isValidDateString, monthRange, todayDateString } from "@/lib/dates";
import { centsToDecimalString, formatMoneyString, toCents } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber } from "@/lib/orders/labels";
import { SALE_UNIT_LABELS, WORK_KINDS } from "@/lib/orders/work-kinds";
import { getMaterialConsumption, REPORT_KIND_GARMENT, REPORT_KIND_LABELS, REPORT_KIND_UNCLASSIFIED } from "@/server/services/material-report-service";

export const metadata: Metadata = { title: "الخامات المستخدمة بفترات" };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** «الخامات المستخدمة بفترات»: consumption by actual consumption date, never mixing units. */
export default async function MaterialsReportPage(props: PageProps<"/costs/materials">) {
  const user = await requirePermission("costs:view");
  const sp = await props.searchParams;
  const month = monthRange(todayDateString());
  const from = isValidDateString(str(sp.from)) ? str(sp.from) : month.from;
  const to = isValidDateString(str(sp.to)) ? str(sp.to) : month.to;
  const filters = { from, to, material: str(sp.material) || undefined, supplierId: /^[0-9a-f-]{36}$/i.test(str(sp.supplier)) ? str(sp.supplier) : undefined, workKind: str(sp.kind) || undefined };
  const [report, suppliers] = await Promise.all([
    from <= to ? getMaterialConsumption(prisma, user, filters) : Promise.resolve({ rows: [], totals: { entries: 0, total: "0.00" } }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="الخامات المستخدمة بفترات" subtitle={`${formatDateAr(from)} — ${formatDateAr(to)}`} backHref="/costs" backLabel="التكاليف" />
      <form className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6" method="get">
        <label className="text-sm">
          من
          <Input type="date" name="from" defaultValue={from} className="mt-1" />
        </label>
        <label className="text-sm">
          لحد
          <Input type="date" name="to" defaultValue={to} className="mt-1" />
        </label>
        <label className="text-sm">
          الخامة
          <Input name="material" defaultValue={filters.material ?? ""} placeholder="مثال: DTF" className="mt-1" />
        </label>
        <label className="text-sm">
          المورد
          <NativeSelect name="supplier" defaultValue={filters.supplierId ?? ""} className="mt-1">
            <option value="">الكل</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-sm">
          نوع الشغل
          <NativeSelect name="kind" defaultValue={filters.workKind ?? ""} className="mt-1">
            <option value="">الكل</option>
            {[...WORK_KINDS, REPORT_KIND_GARMENT, REPORT_KIND_UNCLASSIFIED].map((k) => (
              <option key={k} value={k}>
                {REPORT_KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" className="h-11 self-end rounded-xl">
          عرض
        </Button>
      </form>
      {from > to && <p className="text-sm text-red">«من» لازم يكون قبل «لحد».</p>}
      {report.rows.length === 0 ? (
        <EmptyState icon={BarChart3} title="مفيش استهلاك متسجل في الفترة دي">
          الاستهلاك بيتسجل من «التكاليف» في كل أوردر (الكمية والوحدة وتكلفة الوحدة).
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-graphite">
            {formatNumber(report.totals.entries)} سطر استهلاك · إجمالي التكلفة <b className="tabular text-ink">{formatMoneyString(report.totals.total)}</b>
          </p>
          <ul className="space-y-3">
            {report.rows.map((r) => (
              <li key={r.key} className="rounded-2xl border border-line bg-surface p-4" data-testid="material-row">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-lg font-semibold">
                    {r.materialName}
                    {r.materialVariant && <span className="text-graphite"> — {r.materialVariant}</span>}
                  </p>
                  <p className="tabular font-display text-lg font-semibold">
                    {r.quantity} {SALE_UNIT_LABELS[r.unit] ?? r.unit}
                  </p>
                </div>
                <p className="mt-1 text-sm text-graphite">
                  {r.supplier ? <Link href={`/suppliers/${r.supplier.id}`} className="text-violet hover:underline">{r.supplier.name}</Link> : "من غير مورد"}
                  {" · "}التكلفة <b className="tabular text-ink">{formatMoneyString(r.total)}</b>
                  {r.unitCosts.length > 0 && ` · تكلفة الوحدة ${r.unitCosts.map(formatMoneyString).join(" / ")}`}
                  {" · "}
                  {r.firstDate === r.lastDate ? formatDateAr(r.firstDate) : `${formatDateAr(r.firstDate)} — ${formatDateAr(r.lastDate)}`}
                </p>
                <p className="mt-1 flex flex-wrap gap-1.5 text-xs" data-testid="material-booking">
                  <span className="rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success-ink">متسجل على الموردين {formatMoneyString(centsToDecimalString(toCents(r.total) - toCents(r.draftTotal)))}</span>
                  {r.draftTotal !== "0.00" && <span className="rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning-ink">مسودة (لسه متقفلتش) {formatMoneyString(r.draftTotal)}</span>}
                </p>
                <p className="mt-1 text-xs text-graphite">نوع الشغل: {r.workKinds.map((k) => REPORT_KIND_LABELS[k] ?? k).join("، ")}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-violet">{formatNumber(r.orders.length)} أوردر</summary>
                  <ul className="mt-2 divide-y divide-hairline text-sm">
                    {r.orders.map((o) => (
                      <li key={o.id}>
                        <Link href={`/costs/orders/${o.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 hover:text-violet">
                          <span>
                            {o.title} <span dir="ltr" className="tabular text-xs text-graphite">{formatOrderNumber(o.number)}</span>
                            <span className="ms-2 text-xs text-graphite">{o.dates.map(formatDateAr).join("، ")}</span>
                          </span>
                          <span className="tabular">
                            {o.quantity} {SALE_UNIT_LABELS[r.unit] ?? r.unit} · {formatMoneyString(o.total)}
                            {o.draftTotal !== "0.00" && <span className="ms-1 rounded-full bg-warning-soft px-1.5 text-xs text-warning-ink">{o.draftTotal === o.total ? "مسودة" : `منها ${formatMoneyString(o.draftTotal)} مسودة`}</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-2 text-xs text-graphite">
            <Info className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden="true" />
            «مسودة» = بند متسجل لسه تكاليف أوردره متقفلتش: مش محسوب على المورد ولا في ربحية الأوردر لحد القفل. الكميات بتتجمع لنفس الخامة والنوع والوحدة والمورد بس — وحدات مختلفة مش بتتجمع مع بعض. التاريخ هو تاريخ الاستهلاك المتسجل، والتعديلات بتظهر بقيمتها الأخيرة.
          </p>
        </>
      )}
    </div>
  );
}
