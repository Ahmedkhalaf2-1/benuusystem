import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Plus, Truck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchBox } from "@/components/search-box";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatMoneyString, toCents } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { cn } from "@/lib/utils";
import { getSupplierOutstandingTotal } from "@/server/services/finance-summary-service";
import { listSuppliers } from "@/server/services/supplier-service";

export const metadata: Metadata = { title: "الموردين" };

export default async function SuppliersPage(props: PageProps<"/suppliers">) {
  const user = await requirePermission("suppliers:view-balances");
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  const [result, owed] = await Promise.all([listSuppliers(prisma, user, { query: q, page }), getSupplierOutstandingTotal(prisma, user)]);

  return (
    <div>
      <PageHeader
        title="الموردين"
        subtitle={result.total > 0 ? `${formatNumber(result.total)} مورد` : undefined}
        action={
          hasPermission(user, "suppliers:manage") && (
            <Link href="/suppliers/new" className={buttonVariants({ className: "shrink-0" })}>
              <Plus className="size-5" aria-hidden="true" />
              مورد جديد
            </Link>
          )
        }
      />
      <div className="mb-4 flex items-center justify-between rounded-2xl bg-surface border border-line p-4">
        <span className="text-sm text-muted-foreground">إجمالي اللي علينا للموردين</span>
        <span className="text-xl font-bold text-amber-ink" data-testid="suppliers-owed">
          {formatMoneyString(owed)}
        </span>
      </div>
      <SearchBox action="/suppliers" defaultValue={q} placeholder="دوّر بالاسم أو رقم الموبايل" />

      {result.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-violet-soft text-violet">
            <Truck className="size-7" aria-hidden="true" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold">{q ? "مفيش مورد بالبحث ده" : "لسه مفيش موردين"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q ? "جرّب جزء من الاسم أو آخر أرقام الموبايل." : "تقدر تضيف مورد من هنا أو وأنت بتسجّل تكلفة على أوردر."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-2xl bg-surface border border-line">
          {result.items.map((s) => {
            const owes = toCents(s.outstanding) > 0n;
            return (
              <li key={s.id}>
                <Link href={`/suppliers/${s.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-well active:bg-well">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {s.phone ? <span dir="ltr">{s.phone}</span> : "بدون موبايل"} · مشتريات {formatMoneyString(s.purchased)}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-[0.7rem] text-muted-foreground">لسه ليه</p>
                    <p className={cn("whitespace-nowrap font-bold", owes ? "text-amber-ink" : "text-muted-foreground")}>{formatMoneyString(s.outstanding)}</p>
                  </div>
                  <ChevronLeft className="size-5 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} basePath="/suppliers" params={{ q: q || undefined }} />
    </div>
  );
}
