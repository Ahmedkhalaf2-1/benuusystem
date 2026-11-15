import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banknote } from "lucide-react";
import { voidExpenseAction, voidOutgoingPaymentAction } from "@/app/(app)/finance/actions";
import { SettlementBadge } from "@/components/finance/settlement-badge";
import { VoidRecordForm } from "@/components/finance/void-record-form";
import { Flash } from "@/components/flash";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr, formatDateTimeAr } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/finance/labels";
import { formatMoneyString, toCents } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { getExpenseDetails } from "@/server/services/expense-service";

export const metadata: Metadata = { title: "المصروف" };

const FLASH: Record<string, string> = {
  created: "تم حفظ المصروف ✓",
  "paid-out": "تم تسجيل الدفعة ✓",
  voided: "تم إلغاء المصروف",
  "payment-voided": "تم إلغاء الدفعة",
};

export default async function ExpensePage(props: PageProps<"/expenses/[id]">) {
  const user = await requirePermission("expenses:view");
  const { id } = await props.params;
  const { saved } = await props.searchParams;
  const e = /^[0-9a-f-]{36}$/i.test(id) ? await getExpenseDetails(prisma, user, id) : null;
  if (!e) notFound();
  const canVoid = hasPermission(user, "finance:void");
  const canPay = hasPermission(user, "payables:pay") && !e.voided && toCents(e.remaining) > 0n;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <PageHeader
        title={EXPENSE_CATEGORY_LABELS[e.category]}
        backHref="/expenses"
        backLabel="المصاريف"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {formatDateAr(e.expenseDate)} <SettlementBadge status={e.status} voided={e.voided} />
          </span>
        }
      />

      <section className="rounded-2xl bg-surface border border-line p-4">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-well p-3">
            <dt className="text-xs text-muted-foreground">المبلغ</dt>
            <dd className={cn("mt-1 whitespace-nowrap font-bold", e.voided && "line-through")}>{formatMoneyString(e.amount)}</dd>
          </div>
          <div className="rounded-2xl bg-green-soft p-3">
            <dt className="text-xs text-green-ink">اتدفع</dt>
            <dd className="mt-1 whitespace-nowrap font-bold text-green-ink">{formatMoneyString(e.paid)}</dd>
          </div>
          <div className="rounded-2xl bg-amber-soft p-3">
            <dt className="text-xs text-amber-ink">لسه</dt>
            <dd className="mt-1 whitespace-nowrap font-bold text-amber-ink">{formatMoneyString(e.remaining)}</dd>
          </div>
        </dl>
        {canPay && (
          <Link href={`/expenses/${e.id}/pay`} className={buttonVariants({ size: "lg", className: "mt-3 w-full" })}>
            <Banknote className="size-5" aria-hidden="true" />
            دفع الباقي أو جزء منه
          </Link>
        )}
        {e.description && <p className="mt-3 whitespace-pre-wrap text-sm">{e.description}</p>}
        {e.voidInfo && (
          <p className="mt-3 rounded-xl bg-destructive/5 p-3 text-sm text-destructive">
            المصروف ده ملغي — {e.voidInfo.byName}: {e.voidInfo.reason}
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-surface border border-line p-4">
        <h2 className="mb-2 font-display text-[1.05rem] font-semibold">الدفعات ({e.payments.length})</h2>
        {e.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">لسه متدفعش حاجة من المصروف ده.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {e.payments.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {formatDateAr(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method]} · دفعها {p.recordedByName}
                    </p>
                    {p.notes && <p className="text-xs">{p.notes}</p>}
                  </div>
                  <p className={cn("shrink-0 whitespace-nowrap font-bold", p.voided ? "text-muted-foreground line-through" : "text-green-ink")}>
                    {formatMoneyString(p.amount)}
                  </p>
                </div>
                {p.voided ? (
                  <p className="mt-1 text-xs text-destructive">
                    ملغية — {p.voided.byName}: {p.voided.reason}
                  </p>
                ) : (
                  canVoid && (
                    <VoidRecordForm
                      action={voidOutgoingPaymentAction}
                      id={p.id}
                      returnTo={`/expenses/${e.id}`}
                      label="إلغاء الدفعة دي"
                      confirmLabel="تأكيد إلغاء الدفعة"
                      note="الدفعة هتفضل ظاهرة بس مش هتتحسب في المدفوع."
                    />
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canVoid && !e.voided && (
        <section className="rounded-2xl bg-surface border border-line p-4">
          {toCents(e.paid) > 0n ? (
            <p className="text-sm text-muted-foreground">عشان تلغي المصروف ده، ألغِ مدفوعاته الأول.</p>
          ) : (
            <VoidRecordForm
              action={voidExpenseAction}
              id={e.id}
              label="إلغاء المصروف ده"
              confirmLabel="تأكيد إلغاء المصروف"
              note="المصروف هيفضل ظاهر بس مش هيتحسب في المصاريف."
            />
          )}
        </section>
      )}

      <p className="text-center text-xs text-muted-foreground">
        سجّله {e.recordedByName} · {formatDateTimeAr(e.createdAt)}
      </p>
    </div>
  );
}
