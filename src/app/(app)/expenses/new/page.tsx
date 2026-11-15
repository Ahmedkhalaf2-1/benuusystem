import type { Metadata } from "next";
import { ExpenseForm } from "@/components/finance/expense-form";
import { PageHeader } from "@/components/page-header";
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
      <PageHeader title="سجل مصروف" backHref="/accounts" backLabel="الحسابات" subtitle="مصاريف المحل العامة (مش تكلفة أوردر معيّن)" />
      <ExpenseForm today={todayDateString()} initialCategory={initial} />
    </div>
  );
}
