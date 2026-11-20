import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { DepartmentOrderCard } from "@/components/departments/department-ui";
import { EmptyState } from "@/components/ds/primitives";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchBox } from "@/components/search-box";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { formatNumber } from "@/lib/numbers";
import { cn } from "@/lib/utils";
import { listDepartmentOrders, type DepartmentOrderFilter } from "@/server/services/department-service";
import { orNotFound } from "../../load";

export const metadata: Metadata = { title: "أوردرات القسم" };

const FILTERS: { value: DepartmentOrderFilter; label: string }[] = [
  { value: "open", label: "شغّالة" },
  { value: "completed", label: "مكتملة" },
  { value: "all", label: "الكل" },
];

export default async function DepartmentOrdersPage(props: PageProps<"/departments/[id]/orders">) {
  const user = await requireUser();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const filter = FILTERS.find((f) => f.value === sp.filter)?.value ?? "open";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  const result = await orNotFound(() => listDepartmentOrders(prisma, user, id, { filter, page, query: q }));
  const base = `/departments/${result.department.departmentId}`;
  const link = (f: DepartmentOrderFilter) => {
    const params = new URLSearchParams({ ...(f !== "open" ? { filter: f } : {}), ...(q ? { q } : {}) });
    const qs = params.toString();
    return qs ? `${base}/orders?${qs}` : `${base}/orders`;
  };

  return (
    <div>
      <PageHeader title={`أوردرات ${result.department.name}`} subtitle={`${formatNumber(result.total)} أوردر — بنود القسم بس`} backHref={base} backLabel={result.department.name} />
      <div className="space-y-3">
        <SearchBox action={`${base}/orders`} defaultValue={q} placeholder="دوّر برقم الأوردر أو اسمه أو اسم العميل" hidden={{ filter: filter === "open" ? undefined : filter }} />
        <div className="flex gap-2" aria-label="فلترة">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={link(f.value)}
              aria-current={filter === f.value ? "true" : undefined}
              className={cn(
                "inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors",
                filter === f.value ? "bg-brand-solid text-white" : "border border-line bg-surface text-ink hover:bg-well",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>
      {result.items.length === 0 ? (
        <div className="mt-5">
          <EmptyState icon={ClipboardList} title={q ? "مفيش أوردرات بالبحث ده" : "مفيش أوردرات هنا"}>
            {filter === "open" ? "مفيش شغل مفتوح للقسم دلوقتي." : "جرّب فلتر تاني."}
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {result.items.map((row) => (
            <li key={row.orderId}>
              <DepartmentOrderCard row={row} href={`${base}/orders/${row.orderId}`} />
            </li>
          ))}
        </ul>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} basePath={`${base}/orders`} params={{ filter: filter === "open" ? undefined : filter, q: q || undefined }} />
    </div>
  );
}
