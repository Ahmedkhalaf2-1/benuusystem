import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ChevronLeft, ClipboardCheck } from "lucide-react";
import { EmptyState } from "@/components/ds/primitives";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import type { CostReviewStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { listCostAlerts } from "@/server/services/cost-review-service";
import { COST_STATUS_LABELS } from "@/lib/finance/cost-review-labels";

export const metadata: Metadata = { title: "التكاليف" };


const TONE: Record<CostReviewStatus | "LEGACY", string> = {
  LEGACY: "bg-well text-ink ring-1 ring-line-strong",
  PENDING: "bg-warning-soft text-warning-ink",
  IN_PROGRESS: "bg-violet-soft text-violet",
  CLOSED: "bg-success-soft text-success-ink",
  NEEDS_REVIEW: "bg-danger-soft text-danger-ink",
};

const FILTERS: { value: "open" | CostReviewStatus | "LEGACY"; label: string }[] = [
  { value: "open", label: "محتاج مراجعة" },
  { value: "LEGACY", label: "أوردرات قديمة" },
  { value: "PENDING", label: "لسه" },
  { value: "IN_PROGRESS", label: "بتتسجل" },
  { value: "NEEDS_REVIEW", label: "بعد تعديل" },
  { value: "CLOSED", label: "مقفولة" },
];

/** «التكاليف»: every order's cost review, with alerts for those not closed yet. */
export default async function CostsPage(props: PageProps<"/costs">) {
  const user = await requirePermission("costs:view");
  const sp = await props.searchParams;
  const status = FILTERS.find((f) => f.value === sp.status)?.value ?? "open";
  const { items, counts } = await listCostAlerts(prisma, user, { status });
  const open = counts.PENDING + counts.IN_PROGRESS + counts.NEEDS_REVIEW + counts.LEGACY;
  return (
    <div className="space-y-4">
      <PageHeader
        title="التكاليف"
        subtitle={open > 0 ? `${formatNumber(open)} أوردر تكاليفه لسه مش مقفولة` : "كل التكاليف مقفولة ✓"}
        action={
          <Link href="/costs/materials" className={buttonVariants({ variant: "outline", className: "shrink-0" })}>
            <BarChart3 className="size-4" aria-hidden="true" />
            الخامات المستخدمة بفترات
          </Link>
        }
      />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
        {FILTERS.map((f) => {
          const n = f.value === "open" ? open : counts[f.value];
          return (
            <Link
              key={f.value}
              href={f.value === "open" ? "/costs" : `/costs?status=${f.value}`}
              aria-current={status === f.value ? "true" : undefined}
              className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold", status === f.value ? "bg-brand-solid text-white" : "border border-line bg-surface text-ink hover:bg-well")}
            >
              {f.label}
              <span className="tabular text-xs opacity-80">{formatNumber(n)}</span>
            </Link>
          );
        })}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={status === "open" ? "مفيش أوردرات مستنية مراجعة تكاليف" : "مفيش أوردرات هنا"}>
          كل أوردر جديد بيظهر هنا لحد ما تكاليفه تتسجل وتتقفل (حتى لو صفر).
        </EmptyState>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-line bg-surface">
          {items.map((o) => (
            <li key={o.orderId}>
              <Link href={`/costs/orders/${o.orderId}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-well" data-testid="cost-alert">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {o.title}{" "}
                    <span dir="ltr" className="tabular text-xs text-graphite">
                      {formatOrderNumber(o.number)}
                    </span>
                  </p>
                  <p className="truncate text-xs text-graphite">
                    {o.customerName} · استلام {formatDateAr(o.receivedDate)} · {formatNumber(o.entries)} تكلفة{o.drafts > 0 && ` (${formatNumber(o.drafts)} مسودة)`}
                  </p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", TONE[o.costStatus])}>{COST_STATUS_LABELS[o.costStatus]}</span>
                <ChevronLeft className="size-4 shrink-0 text-graphite" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
