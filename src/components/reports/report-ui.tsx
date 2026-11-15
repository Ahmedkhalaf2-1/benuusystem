import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarRange, Info, TriangleAlert } from "lucide-react";
import { formatDateAr } from "@/lib/dates";
import { formatMoney, toCents } from "@/lib/money";
import { periodParams, type Period } from "@/lib/reports/period";
import { cn } from "@/lib/utils";

export const CASH_LABELS = {
  customers: "دفعات العملاء",
  costs: "تكاليف أوردرات (موردين)",
  expenses: "مصاريف عامة",
  wages: "يوميات العمال",
  advances: "سلف العمال",
} as const;

export const MOVEMENT_LABELS = {
  customer: "دفعة من عميل",
  cost: "دفع تكلفة أوردر",
  expense: "دفع مصروف",
  wage: "يومية عامل",
  advance: "سلفة عامل",
} as const;

export const WARNING_LABELS = {
  open: "الأوردر لسه شغّال — ممكن تتسجل عليه تكاليف أو شغل تاني",
  cancelled: "الأوردر ملغي — الهامش مش ليه معنى",
  "no-costs": "مفيش تكاليف متسجلة عليه",
  "no-labor": "مفيش شغل عمال متسجل عليه",
  "no-price": "سعر الأوردر صفر",
} as const;

/** "40,000 ج.م" from a decimal string. */
export function egp(value: string) {
  return formatMoney(toCents(value));
}

/** This month / last month / a custom range — a plain GET form, works without JS. */
export function PeriodPicker({ period, basePath, extra = {} }: { period: Period; basePath: string; extra?: Record<string, string> }) {
  const href = (p: Record<string, string>) => {
    const qs = new URLSearchParams({ ...extra, ...p }).toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-[background-color,box-shadow] duration-200",
      active ? "bg-brand-solid text-white" : "bg-surface text-ink border border-line hover:bg-well",
    );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" aria-label="الفترة">
        <Link href={href({})} className={chip(period.kind === "this")}>
          الشهر ده
        </Link>
        <Link href={href({ period: "last" })} className={chip(period.kind === "last")}>
          الشهر اللي فات
        </Link>
        <details className="group/period" open={period.kind === "custom"}>
          <summary className={cn(chip(period.kind === "custom"), "cursor-pointer list-none gap-1.5 [&::-webkit-details-marker]:hidden")}>
            <CalendarRange className="size-4" aria-hidden="true" />
            فترة معيّنة
          </summary>
          <form action={basePath} method="get" className="mt-2 flex flex-wrap items-end gap-2 rounded-2xl bg-surface p-3 border border-line">
            {Object.entries(extra).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <input type="hidden" name="period" value="custom" />
            <label className="text-xs text-graphite">
              من
              <input type="date" name="from" defaultValue={period.from} className="mt-1 block h-11 rounded-xl border border-input bg-surface px-2 text-sm text-ink" />
            </label>
            <label className="text-xs text-graphite">
              لحد
              <input type="date" name="to" defaultValue={period.to} className="mt-1 block h-11 rounded-xl border border-input bg-surface px-2 text-sm text-ink" />
            </label>
            <button type="submit" className="h-11 rounded-xl bg-panel px-4 text-sm font-semibold text-on-panel">
              عرض
            </button>
          </form>
        </details>
      </div>
      <p className="text-xs text-graphite">
        من {formatDateAr(period.from)} لحد {formatDateAr(period.to)}
      </p>
    </div>
  );
}

/** Carries the period into links to other reports. */
export function withPeriod(path: string, period: Period, extra: Record<string, string> = {}) {
  const qs = new URLSearchParams({ ...periodParams(period), ...extra }).toString();
  return qs ? `${path}?${qs}` : path;
}

/** A share-of-total bar with the amount and count, for breakdowns. */
export function ShareRow({
  label,
  amount,
  count,
  share,
  tone,
  href,
  unit = "حركة",
}: {
  label: string;
  amount: string;
  count?: number;
  share: string | null;
  tone: string;
  href?: string;
  unit?: string;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <span className="tabular font-display font-semibold whitespace-nowrap">{egp(amount)}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-track">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${share ? Math.min(100, Number(share)) : 0}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-graphite">
        <span>{count !== undefined ? `${count} ${unit}` : ""}</span>
        <span className="tabular">{share !== null ? `${share}%` : "—"}</span>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl px-1 py-2 transition-colors hover:bg-well">
      {body}
    </Link>
  ) : (
    <div className="px-1 py-2">{body}</div>
  );
}

/** A limitation or caveat stated plainly next to the number it affects. */
export function Caveat({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const Icon = tone === "warn" ? TriangleAlert : Info;
  return (
    <p className={cn("flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed", tone === "warn" ? "bg-amber-soft text-amber-ink" : "bg-well text-graphite")}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
