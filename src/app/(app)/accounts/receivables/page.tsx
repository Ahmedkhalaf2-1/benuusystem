import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, ChevronLeft } from "lucide-react";
import { FlowCard, FlowHeader } from "@/components/ds/primitives";
import { StatusBadge } from "@/components/orders/status-badge";
import { Caveat, egp } from "@/components/reports/report-ui";
import { SearchBox } from "@/components/search-box";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { formatOrderNumber } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { getReceivables } from "@/server/services/reports-service";

export const metadata: Metadata = { title: "العملاء اللي عليهم فلوس" };

export default async function ReceivablesPage(props: PageProps<"/accounts/receivables">) {
  const user = await requirePermission("finance:view-summary");
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const overdueOnly = sp.overdue === "1";
  const sort = sp.sort === "due" ? "due" : "amount";
  const r = await getReceivables(prisma, user, { q, overdueOnly, sort });
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: q || undefined, overdue: overdueOnly ? "1" : undefined, sort: sort === "due" ? "due" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/accounts/receivables?${s}` : "/accounts/receivables";
  };
  const chip = (on: boolean) => cn("inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold", on ? "bg-brand-solid text-on-brand" : "bg-surface text-ink border border-line");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FlowHeader icon={Banknote} hue="green" title="لينا عند العملاء" context="سعر الأوردر − الدفعات اللي اتسجلت (من غير الملغي)" backHref="/accounts" backLabel="الحسابات" />

      <section className="rounded-2xl bg-surface p-4 border border-line">
        <p className="text-sm text-graphite">إجمالي اللي لينا</p>
        <p className="tabular font-display text-[2rem] leading-tight font-semibold text-green-ink" data-testid="rec-total">
          {egp(r.total)}
        </p>
        <p className="mt-1 text-xs text-graphite">
          على {r.orderCount} أوردر
          {r.overdueTotal !== "0.00" && <span className="font-semibold text-red"> · منها {egp(r.overdueTotal)} على أوردرات عدّى ميعادها</span>}
        </p>
      </section>

      {r.customers.length > 1 && (
        <FlowCard title="حسب العميل">
          <ul className="divide-y divide-hairline">
            {r.customers.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-violet">
                  <span className="truncate font-semibold">{c.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-sm">
                    <span className="text-xs text-graphite">{c.orders} أوردر</span>
                    <b className="tabular font-display">{egp(c.outstanding)}</b>
                    <ChevronLeft className="size-4 text-graphite" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </FlowCard>
      )}

      <SearchBox action="/accounts/receivables" defaultValue={q} placeholder="دوّر باسم العميل أو الأوردر" hidden={{ overdue: overdueOnly ? "1" : undefined, sort: sort === "due" ? "due" : undefined }} />
      <div className="flex flex-wrap gap-2">
        <Link href={link({ overdue: undefined })} className={chip(!overdueOnly)}>الكل</Link>
        <Link href={link({ overdue: "1" })} className={chip(overdueOnly)}>المتأخر بس</Link>
        <span className="mx-1 self-center text-xs text-graphite">ترتيب</span>
        <Link href={link({ sort: undefined })} className={chip(sort === "amount")}>الأكبر مبلغ</Link>
        <Link href={link({ sort: "due" })} className={chip(sort === "due")}>أقرب ميعاد</Link>
      </div>

      {r.items.length === 0 ? (
        <p className="rounded-2xl bg-surface px-5 py-8 text-center text-sm text-graphite border border-line">
          {q || overdueOnly ? "مفيش أوردرات بالفلتر ده." : "مفيش فلوس لينا عند حد دلوقتي ✓"}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {r.items.map((i) => (
            <li key={i.orderId}>
              <Link href={`/orders/${i.orderId}`} className={cn("block rounded-2xl bg-surface p-4 border border-line hover:border-line-strong", i.overdue && "ring-1 ring-red/25")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display font-semibold">{i.customerName}</p>
                    <p className="truncate text-sm text-graphite">
                      {i.title} <span dir="ltr" className="tabular text-xs">{formatOrderNumber(i.number)}</span>
                    </p>
                  </div>
                  <StatusBadge status={i.status} overdue={i.overdue} />
                </div>
                <dl className="mt-3 grid grid-cols-3 rounded-2xl bg-well px-1 py-2 text-center">
                  <div><dt className="text-[0.68rem] text-graphite">سعر الأوردر</dt><dd className="tabular font-display text-sm font-semibold">{egp(i.price)}</dd></div>
                  <div className="border-x border-hairline"><dt className="text-[0.68rem] text-graphite">اتدفع</dt><dd className="tabular font-display text-sm font-semibold text-green-ink">{egp(i.paid)}</dd></div>
                  <div><dt className="text-[0.68rem] text-graphite">لسه عليه</dt><dd className="tabular font-display text-sm font-semibold text-violet">{egp(i.outstanding)}</dd></div>
                </dl>
                <p className={cn("mt-2 text-xs", i.overdue ? "font-semibold text-red" : "text-graphite")}>ميعاد التسليم {formatDateAr(i.deliveryDate)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(q || overdueOnly) && <p className="text-xs text-graphite">مجموع اللي ظاهر: {egp(r.shownTotal)}</p>}

      {r.needsDecision.length > 0 && (
        <section id="needs-decision" className="scroll-mt-20 space-y-2.5">
          <h2 className="font-display text-[1.05rem] font-semibold">محتاج قرار</h2>
          <Caveat tone="warn">الأوردرات دي عليها فلوس مش داخلة في «لينا عند العملاء»، لأن البرنامج لسه مفيهوش تسجيل مرتجع/رد فلوس. راجعها واتصرف (مثلًا ألغِ الدفعة لو كانت غلط).</Caveat>
          <ul className="space-y-2">
            {r.needsDecision.map((i) => (
              <li key={i.orderId}>
                <Link href={`/orders/${i.orderId}`} className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-3.5 border border-line">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{i.customerName} — {i.title}</span>
                    <span className="block text-xs text-graphite">{i.reason === "cancelled-with-payments" ? `ملغي واتدفع عليه ${egp(i.paid)}` : `اتدفع ${egp(i.paid)} وسعره ${egp(i.price)}`}</span>
                  </span>
                  <ChevronLeft className="size-4 shrink-0 text-graphite" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
