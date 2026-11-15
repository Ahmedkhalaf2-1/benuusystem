import type { Metadata } from "next";
import { ExpenseForm } from "@/components/finance/expense-form";
import { ReceiptText } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import type { ExpenseCategory } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/current-user";
import { todayDateString } from "@/lib/dates";
import { EXPENSE_CATEGORIES } from "@/lib/finance/labels";

export const metadata: Metadata = { title: "سجل مصروف" };

export default async function NewExpensePage(props: PageProps<"/expenses/new">) {
  await requirePermission("expenses:record");
  const { category } = await props.searchParams;
  const initial = EXPENSE_CATEGORIES.includes(category as ExpenseCategory) ? (category as ExpenseCategory) : undefined;
  return (
    <div className="mx-auto max-w-lg">
      <FlowHeader icon={ReceiptText} hue="amber" title="سجل مصروف" backHref="/accounts" backLabel="الحسابات" context="مصاريف المحل العامة (مش تكلفة أوردر معيّن)" />
      <ExpenseForm today={todayDateString()} initialCategory={initial} />
    </div>
  );
}
