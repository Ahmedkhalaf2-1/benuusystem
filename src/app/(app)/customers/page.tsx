import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Plus, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchBox } from "@/components/search-box";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatNumber } from "@/lib/numbers";
import { listCustomers } from "@/server/services/customer-service";

export const metadata: Metadata = { title: "العملاء" };

export default async function CustomersPage(props: PageProps<"/customers">) {
  const user = await requirePermission("customers:view");
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  const result = await listCustomers(prisma, user, { query: q, page });
  const canManage = hasPermission(user, "customers:manage");

  return (
    <div>
      <PageHeader
        title="العملاء"
        subtitle={result.total > 0 ? `${formatNumber(result.total)} عميل` : undefined}
        action={
          canManage && (
            <Link href="/customers/new" className={buttonVariants({ className: "shrink-0" })}>
              <Plus className="size-5" aria-hidden="true" />
              عميل جديد
            </Link>
          )
        }
      />
      <SearchBox action="/customers" defaultValue={q} placeholder="دوّر بالاسم أو رقم الموبايل" />

      {result.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed bg-card px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-primary">
            <UsersRound className="size-7" aria-hidden="true" />
          </span>
          <p className="mt-4 font-bold">{q ? "مفيش عميل بالبحث ده" : "لسه مفيش عملاء"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q ? "جرّب جزء من الاسم أو آخر أرقام الموبايل." : "تقدر تضيف عميل من هنا أو وأنت بتسجّل أوردر."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y overflow-hidden rounded-2xl border bg-card">
          {result.items.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-primary">
                  {c.name.trim().charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {c.phone ? <span dir="ltr">{c.phone}</span> : "بدون موبايل"} · {formatNumber(c.orderCount)} أوردر
                  </p>
                </div>
                <ChevronLeft className="size-5 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} basePath="/customers" params={{ q: q || undefined }} />
    </div>
  );
}
