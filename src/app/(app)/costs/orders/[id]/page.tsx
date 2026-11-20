import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Lock, PlusCircle, ReceiptText } from "lucide-react";
import { AmendEntryForm, CloseCostsForm, ReopenCostsForm } from "@/components/costs/cost-forms";
import { CostRowsEditor, RemoveDraftButton } from "@/components/costs/cost-rows-editor";
import { centsToDecimalString, toCents } from "@/lib/money";
import { FlowCard, FlowHeader } from "@/components/ds/primitives";
import { Flash } from "@/components/flash";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission, isOwner } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr, formatDateTimeAr, todayDateString } from "@/lib/dates";
import { COST_CATEGORY_LABELS } from "@/lib/finance/labels";
import { formatMoneyString } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders/labels";
import { SALE_UNIT_LABELS } from "@/lib/orders/work-kinds";
import { cn } from "@/lib/utils";
import { getCostWorkspace } from "@/server/services/cost-review-service";
import { COST_STATUS_LABELS } from "@/lib/finance/cost-review-labels";

export const metadata: Metadata = { title: "تكاليف الأوردر" };

const FLASH: Record<string, string> = { entries: "اتسجلت بنود التكلفة (مسودات) ✓", removed: "اتشالت المسودة ✓", entry: "اتسجلت التكلفة (مسودة) ✓", closed: "التكاليف اتقفلت واتسجلت على الموردين ✓", reopened: "التكاليف اتفتحت ✓", amended: "التعديل اتحفظ ✓" };

/** One order's costs: entries (drafts until closed), close / reopen, amendments with history. */
export default async function OrderCostsPage(props: PageProps<"/costs/orders/[id]">) {
  const user = await requirePermission("costs:view");
  const { id } = await props.params;
  const { saved } = await props.searchParams;
  const ws = /^[0-9a-f-]{36}$/i.test(id) ? await getCostWorkspace(prisma, user, id) : null;
  if (!ws) notFound();
  const owner = isOwner(user);
  const canRecord = hasPermission(user, "costs:record");
  const status = ws.order.costStatus;
  const closed = status === "CLOSED";
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } });
  const live = ws.entries.filter((e) => !e.voided);
  const today = todayDateString();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <FlowHeader
        icon={ReceiptText}
        hue="amber"
        title={ws.order.title}
        backHref="/costs"
        backLabel="التكاليف"
        context={
          <>
            <span dir="ltr" className="tabular">{formatOrderNumber(ws.order.number)}</span> · {ws.order.customerName} · استلام {formatDateAr(ws.order.receivedDate)}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn("rounded-full px-3 py-1 font-semibold", closed ? "bg-success-soft text-success-ink" : status === "NEEDS_REVIEW" ? "bg-danger-soft text-danger-ink" : "bg-warning-soft text-warning-ink")}>
          {COST_STATUS_LABELS[status ?? "LEGACY"]}
        </span>
        {ws.order.reviewedAt && <span className="text-graphite">آخر قفل: {ws.order.reviewedByName}، {formatDateTimeAr(ws.order.reviewedAt)}</span>}
        <Link href={`/orders/${ws.order.id}`} className="ms-auto font-semibold text-violet hover:underline">
          فتح الأوردر
        </Link>
      </div>

      <p className="flex items-baseline justify-between rounded-2xl bg-panel px-4 py-3 text-on-panel">
        <span className="text-sm text-on-panel-muted">إجمالي تكاليف الأوردر ({live.length} بند)</span>
        <span className="tabular font-display text-2xl font-semibold" data-testid="order-costs-total">
          {formatMoneyString(centsToDecimalString(toCents(ws.totals.posted) + toCents(ws.totals.draft)))}
        </span>
      </p>
      <dl className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-surface py-3 text-center">
        <div>
          <dt className="text-xs text-graphite">متسجل على الموردين</dt>
          <dd className="tabular font-display font-semibold" data-testid="costs-posted">{formatMoneyString(ws.totals.posted)}</dd>
        </div>
        <div className="border-x border-hairline">
          <dt className="text-xs text-graphite">مسودات</dt>
          <dd className="tabular font-display font-semibold text-warning-ink">{formatMoneyString(ws.totals.draft)}</dd>
        </div>
        <div>
          <dt className="text-xs text-graphite">اتدفع للموردين</dt>
          <dd className="tabular font-display font-semibold text-success-ink">{formatMoneyString(ws.totals.paid)}</dd>
        </div>
      </dl>

      <FlowCard title="التكاليف والخامات" icon={ReceiptText}>
        {ws.entries.length === 0 ? (
          <p className="rounded-2xl bg-well p-4 text-sm text-graphite">لسه مفيش تكاليف. لو الأوردر فعلًا مالوش تكلفة، اقفلها كصفر.</p>
        ) : (
          <ul className="space-y-2.5">
            {ws.entries.map((e) => (
              <li key={e.id} className={cn("rounded-2xl border border-line p-3", e.voided && "opacity-60")} data-testid="cost-entry">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    {e.materialName ?? e.description ?? COST_CATEGORY_LABELS[e.category]}
                    {e.materialVariant && <span className="text-graphite"> · {e.materialVariant}</span>}
                    <span className="ms-2 rounded-full bg-well px-2 py-0.5 text-xs font-normal text-graphite">{COST_CATEGORY_LABELS[e.category]}</span>
                    {e.draft && !e.voided && <span className="ms-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning-ink">مسودة</span>}
                    {e.voided && <span className="ms-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger-ink">ملغية</span>}
                  </p>
                  <span className="tabular font-display font-semibold">{formatMoneyString(e.amount)}</span>
                </div>
                <p className="mt-1 text-xs text-graphite">
                  {e.usageQuantity && `${e.usageQuantity} ${SALE_UNIT_LABELS[e.usageUnit ?? ""] ?? e.usageUnit}${e.usageUnitCost ? ` × ${formatMoneyString(e.usageUnitCost)}` : ""} · `}
                  {e.itemLabel && `${e.itemLabel} · `}
                  {e.supplier ? `المورد: ${e.supplier.name}` : "من غير مورد"} · {formatDateAr(e.costDate)}
                  {e.paid !== "0.00" && ` · اتدفع ${formatMoneyString(e.paid)}`}
                </p>
                {e.revisions.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="flex cursor-pointer items-center gap-1 text-graphite">
                      <History className="size-3.5" aria-hidden="true" />
                      {e.revisions.length} تعديل
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {e.revisions.map((r, i) => (
                        <li key={i} className="rounded-lg bg-well p-2">
                          {formatDateTimeAr(r.at)} — {r.byName}: {r.reason}. من {formatMoneyString((r.before as { amount: string }).amount)} لـ {formatMoneyString((r.after as { amount: string }).amount)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {!e.voided && canRecord && (owner || (e.draft && !closed)) && (
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    {e.draft && !closed && <RemoveDraftButton costId={e.id} />}
                    <AmendEntryForm
                      orderId={ws.order.id}
                      today={today}
                      suppliers={suppliers}
                      needsReason={!e.draft || closed}
                      entry={{ id: e.id, version: e.version, usageQuantity: e.usageQuantity, usageUnit: e.usageUnit, usageUnitCost: e.usageUnitCost, amount: e.amount, supplierId: e.supplier?.id ?? null, costDate: e.costDate, materialName: e.materialName, materialVariant: e.materialVariant, notes: e.notes }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </FlowCard>

      {canRecord && !closed && (
        <FlowCard title="إضافة بنود تكلفة" icon={PlusCircle}>
          {/* Remounted after every save (key = number of rows), so new rows always get new keys. */}
          <CostRowsEditor key={ws.entries.length} orderId={ws.order.id} today={today} suppliers={suppliers} items={ws.items.map((i) => ({ id: i.id, label: i.work ? `${i.label} — ${i.work}` : i.label }))} />
        </FlowCard>
      )}

      {owner && (
        <FlowCard title={closed ? "التكاليف مقفولة" : "قفل التكاليف"} icon={Lock}>
          {closed || status === "NEEDS_REVIEW" ? (
            <div className="space-y-3">
              {status === "NEEDS_REVIEW" && (
                <>
                  <p className="text-sm text-graphite">الأوردر اتعدّل بعد قفل التكاليف. راجعها: لو مظبوطة اقفلها تاني، أو افتحها وعدّل.</p>
                  <CloseCostsForm orderId={ws.order.id} version={ws.order.costVersion} suppliers={suppliers} hasEntries={live.length > 0} drafts={live.filter((e) => e.draft).map((e) => ({ id: e.id, label: e.materialName ?? COST_CATEGORY_LABELS[e.category], amount: formatMoneyString(e.amount), supplierId: e.supplier?.id ?? null }))} />
                </>
              )}
              <ReopenCostsForm orderId={ws.order.id} version={ws.order.costVersion} />
              <p className="text-xs text-graphite">ممكن تعدّل أي تكلفة متسجلة حتى بعد القفل (بسبب) من زرار «تعديل» — والفرق بيتظبط على حساب المورد.</p>
            </div>
          ) : (
            <>
              {status === null && live.length > 0 && (
                <p className="mb-3 text-sm text-graphite">أوردر قديم: تكاليفه المتسجلة متسجلة على الموردين بالفعل ومش هتتسجل تاني. لو مفيش تكاليف زيادة، اقفلها كـ«اتراجعت».</p>
              )}
              <CloseCostsForm orderId={ws.order.id} version={ws.order.costVersion} suppliers={suppliers} hasEntries={live.length > 0} drafts={live.filter((e) => e.draft).map((e) => ({ id: e.id, label: e.materialName ?? COST_CATEGORY_LABELS[e.category], amount: formatMoneyString(e.amount), supplierId: e.supplier?.id ?? null }))} />
            </>
          )}
        </FlowCard>
      )}
    </div>
  );
}
