import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, History } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { Pagination } from "@/components/pagination";
import { egp, MOVEMENT_LABELS, PeriodPicker } from "@/components/reports/report-ui";
import { SearchBox } from "@/components/search-box";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/orders/labels";
import { parsePeriod, periodParams } from "@/lib/reports/period";
import { cn } from "@/lib/utils";
import { listCashMovements, type MovementKind } from "@/server/services/reports-service";

export const metadata: Metadata = { title: "كل الحركات" };

const FILTERS: { value: MovementKind | "in" | "out" | ""; label: string }[] = [
  { value: "", label: "الكل" },
  { value: "in", label: "داخل" },
  { value: "out", label: "خارج" },
  { value: "cost", label: "موردين" },
  { value: "expense", label: "مصاريف" },
  { value: "wage", label: "يوميات" },
  { value: "advance", label: "سلف" },
];

export default async function MovementsPage(props: PageProps<"/accounts/movements">) {
  const user = await requirePermission("finance:reports");
  const sp = await props.searchParams;
  const period = parsePeriod(sp);
  const kind = FILTERS.some((f) => f.value === sp.kind && f.value) ? (sp.kind as MovementKind | "in" | "out") : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const r = await listCashMovements(prisma, user, { range: period, kind, q, page });
  const base = { ...periodParams(period), ...(q ? { q } : {}) };
  const link = (k: string) => `/accounts/movements?${new URLSearchParams({ ...base, ...(k ? { kind: k } : {}) })}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FlowHeader icon={History} hue="violet" title="كل الحركات" context="كل دفعة دخلت أو خرجت — من السجلات نفسها" backHref="/accounts" backLabel="الحسابات" />
      <PeriodPicker period={period} basePath="/accounts/movements" extra={{ ...(kind ? { kind } : {}), ...(q ? { q } : {}) }} />
      <SearchBox action="/accounts/movements" defaultValue={q} placeholder="دوّر باسم العميل أو المورد أو العامل" hidden={{ ...periodParams(period), kind }} />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={link(f.value)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold",
              (kind ?? "") === f.value ? "bg-brand-solid text-on-brand" : "bg-surface text-ink border border-line",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-green-soft px-3.5 py-2.5">
          <dt className="text-xs text-green-ink">داخل (من غير الملغي)</dt>
          <dd className="tabular font-display text-lg font-semibold text-green-ink" data-testid="moves-in">{egp(r.totalIn)}</dd>
        </div>
        <div className="rounded-2xl bg-amber-soft px-3.5 py-2.5">
          <dt className="text-xs text-amber-ink">خارج (من غير الملغي)</dt>
          <dd className="tabular font-display text-lg font-semibold text-amber-ink" data-testid="moves-out">{egp(r.totalOut)}</dd>
        </div>
      </dl>

      {r.items.length === 0 ? (
        <p className="rounded-2xl bg-surface px-5 py-8 text-center text-sm text-graphite border border-line">مفيش حركات بالفلتر ده في الفترة دي.</p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-2xl bg-surface border border-line">
          {r.items.map((m) => (
            <li key={`${m.kind}-${m.id}`}>
              <Link href={m.href} className={cn("flex items-start gap-3 px-4 py-3 transition-colors hover:bg-well", m.voided && "opacity-60")}>
                <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", m.direction === "in" ? "bg-green-soft text-green-ink" : "bg-amber-soft text-amber-ink")}>
                  {m.direction === "in" ? <ArrowDownLeft className="size-4" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold">{m.party}</span>
                    <span className={cn("tabular shrink-0 font-display font-semibold", m.direction === "in" ? "text-green-ink" : "text-ink", m.voided && "line-through")}>
                      {m.direction === "in" ? "+" : "−"}
                      {egp(m.amount)}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-graphite">
                    {MOVEMENT_LABELS[m.kind]}
                    {m.detail && ` · ${m.detail}`}
                  </span>
                  <span className="block text-xs text-graphite">
                    {formatDateAr(m.date)} · {PAYMENT_METHOD_LABELS[m.method]} · سجّلها {m.recordedBy}
                  </span>
                  {m.voided && <span className="mt-0.5 block text-xs font-semibold text-red">ملغية — {m.voided.reason}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-graphite">
        {r.validCount} حركة محسوبة{r.count > r.validCount && ` · ${r.count - r.validCount} ملغية ظاهرة للمراجعة بس`}
      </p>
      <Pagination page={r.page} pageCount={r.pageCount} basePath="/accounts/movements" params={{ ...base, kind }} />
    </div>
  );
}
