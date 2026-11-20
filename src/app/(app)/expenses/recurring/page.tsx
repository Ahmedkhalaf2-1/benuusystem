import type { Metadata } from "next";
import { Repeat } from "lucide-react";
import { FlowCard, FlowHeader } from "@/components/ds/primitives";
import { Flash } from "@/components/flash";
import { RecurringExpenseForm, RecurringToggle } from "@/components/finance/monthly-close-forms";
import { egp } from "@/components/reports/report-ui";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { todayDateString } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/finance/labels";
import { cn } from "@/lib/utils";
import { listRecurringExpenses } from "@/server/services/profitability-service";

export const metadata: Metadata = { title: "المصاريف الثابتة" };

/** Fixed monthly expenses (owner). Templates only — the month's rows are generated from «قفل الشهر». */
export default async function RecurringExpensesPage(props: PageProps<"/expenses/recurring">) {
  const user = await requirePermission("finance:reports");
  const { saved } = await props.searchParams;
  const rows = await listRecurringExpenses(prisma, user);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Flash message={saved === "created" ? "اتضاف المصروف الثابت ✓" : saved === "updated" ? "اتحفظ ✓" : undefined} />
      <FlowHeader icon={Repeat} hue="amber" title="المصاريف الثابتة" backHref="/accounts/monthly" backLabel="قفل الشهر" context="إيجار، مرتبات، إنترنت… مصروف بيتكرر كل شهر بنفس المبلغ" />
      <FlowCard title={`المصاريف الثابتة (${rows.length})`} icon={Repeat}>
        {rows.length === 0 ? (
          <p className="rounded-2xl bg-well p-4 text-sm text-graphite">لسه مفيش مصاريف ثابتة.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2.5", !r.isActive && "opacity-60")}>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">
                    {r.description} <span className="font-normal text-graphite">· {EXPENSE_CATEGORY_LABELS[r.category]}</span>
                  </p>
                  <p className="text-xs text-graphite">
                    يوم {r.dayOfMonth} من كل شهر · من {r.startMonth}
                    {r.endMonth ? ` لحد ${r.endMonth}` : ""} · اتسجل {r.generated} مرة{r.isActive ? "" : " · متوقف"}
                  </p>
                </div>
                <span className="tabular font-display font-semibold">{egp(r.amount)}</span>
                <RecurringToggle id={r.id} active={r.isActive} />
              </li>
            ))}
          </ul>
        )}
      </FlowCard>
      <FlowCard title="إضافة مصروف ثابت" icon={Repeat}>
        <RecurringExpenseForm thisMonth={todayDateString().slice(0, 7)} />
        <p className="mt-3 text-xs text-graphite">مفيش فلوس بتتحرك هنا. من صفحة «قفل الشهر» بتسجّل مصاريف الشهر الثابتة مرة واحدة (مستحيل تتسجل مرتين)، وبعدين تدفعها عادي من صفحة المصروف. يوميات العمال متتسجلش هنا.</p>
      </FlowCard>
    </div>
  );
}
