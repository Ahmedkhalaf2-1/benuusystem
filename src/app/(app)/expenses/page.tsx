import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Receipt, Wallet } from "lucide-react";
import { SettlementBadge } from "@/components/finance/settlement-badge";
import { NativeSelect } from "@/components/forms/field";
import { PageHeader } from "@/components/page-header";
import { SoftIcon } from "@/components/ds/primitives";
import { Pagination } from "@/components/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExpenseCategory } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr, isValidDateString, monthRange, previousMonthRange, todayDateString } from "@/lib/dates";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/finance/labels";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { cn } from "@/lib/utils";
import { listExpenses } from "@/server/services/expense-service";

export const metadata: Metadata = { title: "المصاريف" };

type Period = "this" | "last" | "custom";

export default async function ExpensesPage(props: PageProps<"/expenses">) {
  const user = await requirePermission("expenses:view");
  const sp = await props.searchParams;
  const today = todayDateString();
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  let period: Period = str(sp.period) === "last" ? "last" : str(sp.period) === "custom" ? "custom" : "this";
  let range = period === "last" ? previousMonthRange(today) : monthRange(today);
  if (period === "custom") {
    const from = str(sp.from);
    const to = str(sp.to);
    if (isValidDateString(from) && isValidDateString(to) && from <= to) range = { from, to };
    else period = "this";
  }
  const category = EXPENSE_CATEGORIES.includes(str(sp.category) as ExpenseCategory) ? (str(sp.category) as ExpenseCategory) : undefined;
  const page = Math.max(1, Number.parseInt(str(sp.page) || "1", 10) || 1);

  const result = await listExpenses(prisma, user, { ...range, category, page });

  const link = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { period, category, ...(period === "custom" ? range : {}), ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "period" && v === "this")) params.set(k, v);
    const qs = params.toString();
    return qs ? `/expenses?${qs}` : "/expenses";
  };
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-[background-color,box-shadow] duration-200",
      active ? "bg-brand-solid text-white" : "bg-surface text-ink border border-line hover:bg-well",
    );

  return (
    <div>
      <PageHeader
        title="المصاريف"
        subtitle="مصاريف المحل العامة — منفصلة عن تكاليف الأوردرات"
        action={
          hasPermission(user, "expenses:record") && (
            <Link href="/expenses/new" className={buttonVariants({ className: "shrink-0" })}>
              <Plus className="size-5" aria-hidden="true" />
              سجل مصروف
            </Link>
          )
        }
      />

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" aria-label="الفترة">
          <Link href={link({ period: "this", from: undefined, to: undefined, page: undefined })} className={chip(period === "this")}>
            الشهر ده
          </Link>
          <Link href={link({ period: "last", from: undefined, to: undefined, page: undefined })} className={chip(period === "last")}>
            الشهر اللي فات
          </Link>
        </div>
        <details open={period === "custom" || !!category} className="rounded-2xl bg-surface p-3 border border-line">
          <summary className="flex min-h-9 cursor-pointer items-center text-sm font-semibold">فترة معيّنة أو نوع مصروف</summary>
          <form action="/expenses" method="get" className="mt-3 grid grid-cols-2 gap-2">
            <input type="hidden" name="period" value="custom" />
            <label className="text-xs text-muted-foreground">
              من
              <Input type="date" name="from" defaultValue={range.from} className="mt-1" />
            </label>
            <label className="text-xs text-muted-foreground">
              لحد
              <Input type="date" name="to" defaultValue={range.to} className="mt-1" />
            </label>
            <label className="col-span-2 text-xs text-muted-foreground">
              النوع
              <NativeSelect name="category" defaultValue={category ?? ""} className="mt-1">
                <option value="">كل الأنواع</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EXPENSE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button type="submit" variant="outline" className="col-span-2">
              عرض
            </Button>
          </form>
        </details>
        <p className="text-sm text-muted-foreground">
          من {formatDateAr(range.from)} لحد {formatDateAr(range.to)}
          {category && ` · ${EXPENSE_CATEGORY_LABELS[category]}`}
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-3 rounded-2xl bg-surface p-1.5 border border-line">
        <div className="rounded-2xl bg-amber-soft px-3 py-3">
          <dt className="text-[0.7rem] font-semibold text-amber-ink">المصاريف المسجلة</dt>
          <dd className="tabular mt-1 whitespace-nowrap font-display text-base font-semibold sm:text-lg" data-testid="expenses-recorded">
            {formatMoneyString(result.totals.recorded)}
          </dd>
        </div>
        <div className="px-3 py-3">
          <dt className="text-[0.7rem] text-graphite">اتدفع منها (كاش)</dt>
          <dd className="tabular mt-1 whitespace-nowrap font-display text-base font-semibold text-green-ink sm:text-lg" data-testid="expenses-paid">
            {formatMoneyString(result.totals.paid)}
          </dd>
        </div>
        <div className="px-3 py-3">
          <dt className="text-[0.7rem] text-graphite">لسه متدفعش</dt>
          <dd className="tabular mt-1 whitespace-nowrap font-display text-base font-semibold text-amber-ink sm:text-lg">{formatMoneyString(result.totals.remaining)}</dd>
        </div>
      </dl>

      {result.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-violet-soft text-violet">
            <Wallet className="size-7" aria-hidden="true" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold">مفيش مصاريف في الفترة دي</p>
          <p className="mt-1 text-sm text-muted-foreground">أي مصروف تسجله (إيجار، كهرباء، …) هيظهر هنا.</p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-2xl bg-surface border border-line">
          {result.items.map((e) => (
            <li key={e.id}>
              <Link href={`/expenses/${e.id}`} className="block px-4 py-3 transition-colors hover:bg-well active:bg-well">
                <div className="flex items-start justify-between gap-3">
                  <SoftIcon icon={Receipt} hue="amber" className={cn("mt-0.5", e.voided && "opacity-50")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-semibold", e.voided && "text-muted-foreground line-through")}>{EXPENSE_CATEGORY_LABELS[e.category]}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {formatDateAr(e.expenseDate)}
                      {e.description && ` · ${e.description}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className={cn("tabular whitespace-nowrap font-display font-semibold", e.voided && "text-graphite line-through")}>{formatMoneyString(e.amount)}</p>
                    <SettlementBadge status={e.status} voided={e.voided} />
                  </div>
                </div>
                {!e.voided && e.status !== "PAID" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    اتدفع {formatMoneyString(e.paid)} · لسه {formatMoneyString(e.remaining)}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{formatNumber(result.totals.count)} مصروف في الفترة دي (من غير الملغي).</p>
      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        basePath="/expenses"
        params={{
          period: period === "this" ? undefined : period,
          from: period === "custom" ? range.from : undefined,
          to: period === "custom" ? range.to : undefined,
          category,
        }}
      />
    </div>
  );
}
