import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { payExpenseAction } from "@/app/(app)/finance/actions";
import { PayOutForm } from "@/components/finance/pay-out-form";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr, todayDateString } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/finance/labels";
import { formatMoneyString, toCents } from "@/lib/money";
import { getExpenseDetails } from "@/server/services/expense-service";

export const metadata: Metadata = { title: "دفع مصروف" };

export default async function PayExpensePage(props: PageProps<"/expenses/[id]/pay">) {
  const user = await requirePermission("payables:pay");
  if (!hasPermission(user, "expenses:view")) notFound();
  const { id } = await props.params;
  const expense = /^[0-9a-f-]{36}$/i.test(id) ? await getExpenseDetails(prisma, user, id) : null;
  if (!expense) notFound();
  if (expense.voided || toCents(expense.remaining) <= 0n) redirect(`/expenses/${expense.id}`);

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="دفع مصروف" backHref={`/expenses/${expense.id}`} backLabel="رجوع" />
      <div className="mb-5 rounded-2xl border bg-card p-4">
        <p className="font-bold">{EXPENSE_CATEGORY_LABELS[expense.category]}</p>
        <p className="text-sm text-muted-foreground">
          {formatDateAr(expense.expenseDate)}
          {expense.description && ` · ${expense.description}`}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">المبلغ</dt>
            <dd className="font-bold">{formatMoneyString(expense.amount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">اتدفع</dt>
            <dd className="font-bold text-emerald-700">{formatMoneyString(expense.paid)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">لسه</dt>
            <dd className="font-bold text-primary">{formatMoneyString(expense.remaining)}</dd>
          </div>
        </dl>
      </div>
      <PayOutForm action={payExpenseAction} targetId={expense.id} remaining={expense.remaining} today={todayDateString()} />
    </div>
  );
}
