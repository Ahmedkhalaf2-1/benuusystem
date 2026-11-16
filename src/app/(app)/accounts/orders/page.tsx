import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { FlowHeader } from "@/components/ds/primitives";
import { StatusBadge } from "@/components/orders/status-badge";
import { Caveat, egp, WARNING_LABELS } from "@/components/reports/report-ui";
import { SearchBox } from "@/components/search-box";
import { requirePermission } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { toCents } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { getOrderContributions } from "@/server/services/reports-service";

export const metadata: Metadata = { title: "تكاليف وهامش الأوردرات" };

const STATUS = [
  { value: "all", label: "الكل" },
  { value: "open", label: "شغّالة" },
  { value: "completed", label: "مكتملة" },
] as const;

export default async function OrderContributionPage(props: PageProps<"/accounts/orders">) {
  const user = await requirePermission("finance:reports");
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const status = STATUS.find((s) => s.value === sp.status)?.value ?? "all";
  const rows = await getOrderContributions(prisma, user, { status, q: q || undefined });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FlowHeader icon={ClipboardList} hue="violet" title="هامش الأوردرات" context="قبل المصاريف العامة — مش الربح النهائي" backHref="/accounts" backLabel="الحسابات" />
      <Caveat>
        هامش الأوردر = سعره − التكاليف المسجلة عليه (حتى لو متدفعتش) − نصيبه من يوميات العمال. مش داخل فيه: الإيجار والكهربا والمصاريف العامة، واليوميات اللي مش متوزعة على أوردرات، وأي تكلفة لسه متسجلتش.
      </Caveat>
      <SearchBox action="/accounts/orders" defaultValue={q} placeholder="دوّر باسم العميل أو الأوردر" hidden={{ status: status === "all" ? undefined : status }} />
      <div className="flex gap-2">
        {STATUS.map((s) => (
          <Link
            key={s.value}
            href={`/accounts/orders?${new URLSearchParams({ ...(q ? { q } : {}), ...(s.value === "all" ? {} : { status: s.value }) })}`}
            className={cn("inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold", status === s.value ? "bg-brand-solid text-on-brand" : "bg-surface text-ink border border-line")}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-surface px-5 py-8 text-center text-sm text-graphite border border-line">مفيش أوردرات بالفلتر ده.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const c = toCents(r.contribution);
            return (
              <li key={r.orderId}>
                <Link href={`/orders/${r.orderId}#contribution`} className="block rounded-2xl bg-surface p-4 border border-line hover:border-line-strong">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-display font-semibold">{r.customerName}</p>
                      <p className="truncate text-sm text-graphite">
                        {r.title} <span dir="ltr" className="tabular text-xs">{formatOrderNumber(r.number)}</span>
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-4 gap-1 rounded-2xl bg-well px-1 py-2 text-center">
                    <div><dt className="text-[0.66rem] text-graphite">السعر</dt><dd className="tabular font-display text-[0.82rem] font-semibold">{egp(r.price)}</dd></div>
                    <div><dt className="text-[0.66rem] text-graphite">تكاليف</dt><dd className="tabular font-display text-[0.82rem] font-semibold text-amber-ink">{egp(r.directCosts)}</dd></div>
                    <div><dt className="text-[0.66rem] text-graphite">عمالة</dt><dd className="tabular font-display text-[0.82rem] font-semibold text-rose-ink">{egp(r.labor)}</dd></div>
                    <div><dt className="text-[0.66rem] text-graphite">الهامش</dt><dd className={cn("tabular font-display text-[0.82rem] font-semibold", c < 0n ? "text-red" : "text-green-ink")}>{egp(r.contribution)}</dd></div>
                  </dl>
                  <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-graphite">{r.percent !== null ? `${r.percent}% من السعر` : "—"}</span>
                    {r.warnings.length > 0 && <span className="text-amber-ink">{r.warnings.map((w) => WARNING_LABELS[w]).join("، ")}</span>}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-graphite">بيظهر لحد ٢٠٠ أوردر، الأحدث الأول. دوّر لو مش لاقي أوردر.</p>
    </div>
  );
}
