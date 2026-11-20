import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Info, ReceiptText, Scale, Wallet } from "lucide-react";
import { EmptyState, FlowCard } from "@/components/ds/primitives";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/current-user";
import { isOwner } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, PAYMENT_METHOD_LABELS } from "@/lib/orders/labels";
import { requireDepartment } from "@/server/services/department-access";
import { getDepartmentSettlements, getMySettlement, type SettlementTotals } from "@/server/services/partner-settlement-service";
import { orNotFound } from "../../load";

export const metadata: Metadata = { title: "حساب التسوية" };

function Totals({ totals }: { totals: SettlementTotals }) {
  return (
    <dl className="grid grid-cols-3 gap-1 rounded-2xl bg-well py-3 text-center">
      <div>
        <dt className="text-xs text-graphite">المستحق</dt>
        <dd className="tabular font-display font-semibold" data-testid="settlement-payable">{formatMoneyString(totals.payable)}</dd>
      </div>
      <div className="border-x border-hairline">
        <dt className="text-xs text-graphite">اتدفع</dt>
        <dd className="tabular font-display font-semibold text-success-ink">{formatMoneyString(totals.paid)}</dd>
      </div>
      <div>
        <dt className="text-xs text-graphite">الباقي</dt>
        <dd className="tabular font-display font-semibold text-violet" data-testid="settlement-remaining">{formatMoneyString(totals.remaining)}</dd>
      </div>
    </dl>
  );
}

const NOTE = "حساب التسوية = الشغل اللي اتسجل للشريك كتكلفة على الأوردرات (بسعر متفق عليه للشغلانة أو للقطعة) والمدفوع منه. منفصل تمامًا عن تحصيل العميل: العميل لما يدفع، الشريك مش بياخد حاجة تلقائي.";

/**
 * Partner: its OWN settlement for this department (settlements switch).
 * Owner: what is owed for this department's work, per supplier / partner.
 */
export default async function DepartmentSettlementPage(props: PageProps<"/departments/[id]/settlement">) {
  const user = await requireUser();
  const { id } = await props.params;
  const grant = await orNotFound(() => requireDepartment(prisma, user, id, "settlements"));
  const base = `/departments/${grant.departmentId}`;

  if (isOwner(user)) {
    const data = await getDepartmentSettlements(prisma, user, grant.departmentId);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title={`التسويات — ${grant.name}`} subtitle="المستحق للموردين والشركاء على شغل القسم" backHref={base} backLabel={grant.name} />
        <FlowCard title="الإجمالي" icon={Scale}>
          <Totals totals={data.totals} />
        </FlowCard>
        {data.rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title="مفيش شغل متسجل للقسم كتكلفة">
            سجّل شغل الشريك من صفحة الأوردر («إضافة تكلفة») واختار القسم والمورد بتاع الشريك.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {data.rows.map((r) => (
              <li key={r.supplierId ?? "none"} className="rounded-2xl border border-line bg-surface p-4">
                <p className="mb-2 font-display font-semibold">
                  {r.supplierId ? <Link href={`/suppliers/${r.supplierId}`} className="hover:text-violet">{r.supplierName}</Link> : r.supplierName}
                  {r.partnerName && <span className="ms-2 rounded-full bg-violet-soft px-2 py-0.5 text-xs text-violet">شريك: {r.partnerName}</span>}
                </p>
                <Totals totals={r.totals} />
                <p className="mt-1 text-xs text-graphite">{formatNumber(r.totals.jobs)} شغلانة</p>
              </li>
            ))}
          </ul>
        )}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-graphite">
          <Info className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden="true" />
          {NOTE} الدفع للشريك بيتسجل من صفحة المورد («دفع») زي أي مورد.
        </p>
      </div>
    );
  }

  const s = await getMySettlement(prisma, user, grant.departmentId).catch(() => notFound());
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="حساب التسوية بتاعي" subtitle={grant.name} backHref={base} backLabel={grant.name} />
      {!s.linked ? (
        <EmptyState icon={Scale} title="حسابك لسه مش مربوط بحساب تسوية">
          المدير لسه ماربطش حسابك بحساب المورد اللي بيتسجل عليه شغلك. كلّمه.
        </EmptyState>
      ) : (
        <>
          <FlowCard title="الإجمالي" icon={Scale}>
            <Totals totals={s.totals} />
          </FlowCard>
          <FlowCard title="الشغل اللي ليك" icon={ReceiptText}>
            {s.jobs.length === 0 ? (
              <p className="rounded-2xl bg-well p-4 text-sm text-graphite">لسه مفيش شغل متسجل لك في القسم ده.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {s.jobs.map((j) => (
                  <li key={j.id} className="py-2.5 text-sm" data-testid="settlement-job">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {j.orderTitle ?? "أوردر خاص"}{" "}
                        <span dir="ltr" className="tabular text-xs text-graphite">{formatOrderNumber(j.orderNumber)}</span>
                      </span>
                      <span className="tabular shrink-0 font-semibold">{formatMoneyString(j.amount)}</span>
                    </p>
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-graphite">
                      <span>
                        {formatDateAr(j.costDate)}
                        {j.description && ` · ${j.description}`}
                        {j.quantity !== null && j.unitCost && ` · ${formatNumber(j.quantity)} × ${formatMoneyString(j.unitCost)}`}
                      </span>
                      <span>اتدفع {formatMoneyString(j.paid)} · الباقي {formatMoneyString(j.remaining)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </FlowCard>
          <FlowCard title="الدفعات اللي اتدفعت لك" icon={Wallet}>
            {s.payments.length === 0 ? (
              <p className="rounded-2xl bg-well p-4 text-sm text-graphite">لسه مفيش دفعات.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {s.payments.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                    <span>
                      {formatDateAr(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method]}{" "}
                      <span dir="ltr" className="tabular text-xs text-graphite">{formatOrderNumber(p.orderNumber)}</span>
                    </span>
                    <span className="tabular font-semibold text-success-ink">{formatMoneyString(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </FlowCard>
        </>
      )}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-graphite">
        <Info className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden="true" />
        {NOTE}
      </p>
    </div>
  );
}
