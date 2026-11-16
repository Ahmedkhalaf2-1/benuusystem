import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Truck } from "lucide-react";
import { FlowCard, FlowHeader } from "@/components/ds/primitives";
import { Caveat, egp } from "@/components/reports/report-ui";
import { SearchBox } from "@/components/search-box";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { COST_CATEGORY_LABELS, EXPENSE_CATEGORY_LABELS } from "@/lib/finance/labels";
import { formatOrderNumber } from "@/lib/orders/labels";
import { getPayables } from "@/server/services/reports-service";

export const metadata: Metadata = { title: "علينا للموردين" };

export default async function PayablesPage(props: PageProps<"/accounts/payables">) {
  const user = await requirePermission("finance:reports");
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const p = await getPayables(prisma, user, { q });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FlowHeader icon={Truck} hue="blue" title="علينا كام؟" context="التكلفة اللي اتسجلت − اللي اتدفع منها فعلًا" backHref="/accounts" backLabel="الحسابات" />

      <section className="grid grid-cols-3 gap-2 rounded-2xl bg-surface p-1.5 border border-line">
        <div className="rounded-2xl bg-blue-soft px-3 py-3">
          <p className="text-[0.7rem] font-semibold text-blue-ink">للموردين</p>
          <p className="tabular mt-1 font-display text-base font-semibold sm:text-lg" data-testid="pay-suppliers">{egp(p.supplierTotal)}</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-[0.7rem] text-graphite">مصاريف متدفعتش</p>
          <p className="tabular mt-1 font-display text-base font-semibold sm:text-lg">{egp(p.unpaidExpensesTotal)}</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-[0.7rem] text-graphite">تكاليف من غير مورد</p>
          <p className="tabular mt-1 font-display text-base font-semibold sm:text-lg">{egp(p.unpaidCostsTotal)}</p>
        </div>
      </section>

      <FlowCard title="الموردين" icon={Truck} hue="blue">
        <SearchBox action="/accounts/payables" defaultValue={q} placeholder="دوّر باسم المورد" />
        {p.suppliers.length === 0 ? (
          <p className="mt-3 text-sm text-graphite">{q ? "مفيش مورد بالاسم ده عليه فلوس." : "مفيش فلوس علينا لأي مورد ✓"}</p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline">
            {p.suppliers.map((s) => (
              <li key={s.id}>
                <Link href={`/suppliers/${s.id}`} className="block py-3 hover:text-violet">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-semibold">{s.name}</span>
                    <span className="flex items-center gap-1.5">
                      <b className="tabular font-display text-blue-ink">{egp(s.outstanding)}</b>
                      <ChevronLeft className="size-4 text-graphite" aria-hidden="true" />
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-graphite">
                    اشترينا {egp(s.purchased)} · دفعنا {egp(s.paid)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </FlowCard>

      {p.unpaidCosts.length > 0 && (
        <FlowCard title="تكاليف أوردرات من غير مورد لسه متدفعتش">
          <ul className="divide-y divide-hairline">
            {p.unpaidCosts.map((c) => (
              <li key={c.id}>
                <Link href={`/orders/${c.order.id}#costs`} className="flex items-center justify-between gap-3 py-2.5 hover:text-violet">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{c.description || COST_CATEGORY_LABELS[c.category]}</span>
                    <span className="block text-xs text-graphite">
                      <span dir="ltr">{formatOrderNumber(c.order.number)}</span> {c.order.title} · {formatDateAr(c.date)}
                    </span>
                  </span>
                  <b className="tabular shrink-0 font-display">{egp(c.remaining)}</b>
                </Link>
              </li>
            ))}
          </ul>
        </FlowCard>
      )}

      {p.unpaidExpenses.length > 0 && (
        <FlowCard title="مصاريف عامة لسه متدفعتش" aside={<span className="tabular text-sm font-semibold">{egp(p.unpaidExpensesTotal)}</span>}>
          <ul className="divide-y divide-hairline">
            {p.unpaidExpenses.map((e) => (
              <li key={e.id}>
                <Link href={`/expenses/${e.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-violet">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{EXPENSE_CATEGORY_LABELS[e.category]}{e.description && ` — ${e.description}`}</span>
                    <span className="block text-xs text-graphite">{formatDateAr(e.date)}</span>
                  </span>
                  <b className="tabular shrink-0 font-display">{egp(e.remaining)}</b>
                </Link>
              </li>
            ))}
          </ul>
        </FlowCard>
      )}
      <Caveat>شراء بالآجل بيتحسب تكلفة يوم ما اتسجل، والفلوس بتتحسب خارجة يوم ما اتدفعت بس — عشان كده الرقمين مش زي بعض.</Caveat>
    </div>
  );
}
