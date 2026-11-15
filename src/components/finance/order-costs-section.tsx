import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import { voidOrderCostAction, voidOutgoingPaymentAction } from "@/app/(app)/finance/actions";
import { buttonVariants } from "@/components/ui/button";
import { formatDateAr } from "@/lib/dates";
import { COST_CATEGORY_LABELS } from "@/lib/finance/labels";
import { formatMoneyString, toCents } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import type { OrderCostSummary } from "@/server/services/cost-service";
import { SettlementBadge } from "./settlement-badge";
import { VoidRecordForm } from "./void-record-form";

/**
 * "تكاليف الأوردر": what this order cost, what of that is paid, what is still
 * owed. Kept completely separate from the customer's payments.
 */
export function OrderCostsSection({
  orderId,
  summary,
  canRecord,
  canPay,
  canVoid,
}: {
  orderId: string;
  summary: OrderCostSummary;
  canRecord: boolean;
  canPay: boolean;
  canVoid: boolean;
}) {
  const returnTo = `/orders/${orderId}#costs`;
  return (
    <section id="costs" className="scroll-mt-20 rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">
          <ReceiptText className="size-5 text-primary" aria-hidden="true" />
          تكاليف الأوردر
        </h2>
        {canRecord && (
          <Link href={`/orders/${orderId}/costs/new`} className={buttonVariants({ size: "default" })}>
            <Plus className="size-5" aria-hidden="true" />
            إضافة تكلفة
          </Link>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-muted/60 p-2.5">
          <dt className="text-[0.7rem] text-muted-foreground">إجمالي التكاليف</dt>
          <dd className="mt-0.5 whitespace-nowrap text-sm font-bold" data-testid="costs-total">
            {formatMoneyString(summary.totals.costs)}
          </dd>
        </div>
        <div className="rounded-xl bg-emerald-50 p-2.5">
          <dt className="text-[0.7rem] text-emerald-800">اتدفع منها</dt>
          <dd className="mt-0.5 whitespace-nowrap text-sm font-bold text-emerald-700" data-testid="costs-paid">
            {formatMoneyString(summary.totals.paid)}
          </dd>
        </div>
        <div className="rounded-xl bg-amber-50 p-2.5">
          <dt className="text-[0.7rem] text-amber-900">لسه متدفعش</dt>
          <dd className="mt-0.5 whitespace-nowrap text-sm font-bold text-amber-800" data-testid="costs-outstanding">
            {formatMoneyString(summary.totals.outstanding)}
          </dd>
        </div>
      </dl>

      {summary.entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">لسه مفيش تكاليف على الأوردر ده.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {summary.entries.map((c) => {
            const voided = c.voided !== null;
            const remaining = toCents(c.remaining);
            return (
              <li key={c.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cn("font-semibold", voided && "text-muted-foreground line-through")}>
                      {c.description ?? COST_CATEGORY_LABELS[c.category]}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {COST_CATEGORY_LABELS[c.category]} · {formatDateAr(c.costDate)}
                      {c.supplier && (
                        <>
                          {" · "}
                          <Link href={`/suppliers/${c.supplier.id}`} className="text-primary hover:underline">
                            {c.supplier.name}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className={cn("whitespace-nowrap font-bold", voided && "text-muted-foreground line-through")}>
                      {formatMoneyString(c.amount)}
                    </p>
                    <SettlementBadge status={c.status} voided={voided} />
                  </div>
                </div>

                {!voided && c.status !== "PAID" && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
                    <span>
                      اتدفع {formatMoneyString(c.paid)} · <b>لسه {formatMoneyString(c.remaining)}</b>
                    </span>
                    {canPay && remaining > 0n && (
                      <Link href={`/costs/${c.id}/pay`} className={buttonVariants({ size: "sm", className: "h-9 px-3" })}>
                        ادفع
                      </Link>
                    )}
                  </div>
                )}
                {c.voided && (
                  <p className="mt-1 text-xs text-destructive">
                    ألغاها {c.voided.byName} — {c.voided.reason}
                  </p>
                )}

                {(c.payments.length > 0 || c.notes || (canVoid && !voided)) && (
                  <details className="mt-1">
                    <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-lg px-1 text-sm text-muted-foreground hover:text-foreground">
                      التفاصيل والمدفوعات ({c.payments.length})
                    </summary>
                    <div className="mt-1 space-y-2 rounded-xl border bg-background p-3 text-sm">
                      {c.notes && <p>ملاحظات: {c.notes}</p>}
                      <p className="text-xs text-muted-foreground">سجّلها: {c.recordedByName}</p>
                      {c.payments.map((p) => (
                        <div key={p.id} className="border-t pt-2">
                          <p className={cn("font-semibold", p.voided && "text-muted-foreground line-through")}>
                            {formatMoneyString(p.amount)} · {PAYMENT_METHOD_LABELS[p.method]} · {formatDateAr(p.paidAt)}
                          </p>
                          <p className="text-xs text-muted-foreground">دفعها: {p.recordedByName}</p>
                          {p.voided ? (
                            <p className="text-xs text-destructive">
                              ملغية — {p.voided.byName}: {p.voided.reason}
                            </p>
                          ) : (
                            canVoid && (
                              <VoidRecordForm
                                action={voidOutgoingPaymentAction}
                                id={p.id}
                                returnTo={returnTo}
                                label="إلغاء الدفعة دي"
                                confirmLabel="تأكيد إلغاء الدفعة"
                                note="الدفعة هتفضل ظاهرة بس مش هتتحسب في المدفوع."
                              />
                            )
                          )}
                        </div>
                      ))}
                      {canVoid && !voided && (
                        <div className="border-t pt-2">
                          {toCents(c.paid) > 0n ? (
                            <p className="text-xs text-muted-foreground">عشان تلغي التكلفة، ألغِ مدفوعاتها الأول.</p>
                          ) : (
                            <VoidRecordForm
                              action={voidOrderCostAction}
                              id={c.id}
                              label="إلغاء التكلفة دي"
                              confirmLabel="تأكيد إلغاء التكلفة"
                              note="التكلفة هتفضل ظاهرة بس مش هتتحسب في تكاليف الأوردر."
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        التكاليف دي منفصلة عن فلوس العميل. الربح النهائي مش بيتحسب هنا لأن مرتبات العمال والمصاريف العامة لسه مش داخلة.
      </p>
    </section>
  );
}
