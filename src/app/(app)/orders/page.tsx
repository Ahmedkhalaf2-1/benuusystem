import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { OrderCard } from "@/components/orders/order-card";
import { ProductionTrack } from "@/components/ds/production-track";
import { Flash } from "@/components/flash";
import { StatusBadge } from "@/components/orders/status-badge";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchBox } from "@/components/search-box";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateAr } from "@/lib/dates";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { listOrders, type OrderSort, type OrderStatusFilter } from "@/server/services/order-service";

export const metadata: Metadata = { title: "كل الأوردرات" };

const FILTERS: { value: OrderStatusFilter; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "open", label: "شغّالة" },
  { value: "overdue", label: "متأخرة" },
  { value: "NEW", label: "جديد" },
  { value: "IN_PROGRESS", label: "تحت التنفيذ" },
  { value: "COMPLETED", label: "مكتملة" },
  { value: "CANCELLED", label: "ملغي" },
];

const SORTS: { value: OrderSort; label: string }[] = [
  // newest/oldest follow the business receipt date; «آخر تسجيل» the real entry time.
  { value: "newest", label: "الأحدث استلامًا" },
  { value: "oldest", label: "الأقدم" },
  { value: "delivery", label: "أقرب تسليم" },
  { value: "recorded", label: "آخر تسجيل" },
];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export default async function OrdersPage(props: PageProps<"/orders">) {
  const user = await requirePermission("orders:view");
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const canArchive = hasPermission(user, "orders:archive");
  const filters = canArchive ? [...FILTERS, { value: "archived" as const, label: "المحذوفة" }] : FILTERS;
  const status = pick(sp.status, filters.map((f) => f.value), "all");
  const sort = pick(sp.sort, SORTS.map((s) => s.value), "newest");
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);

  const result = await listOrders(prisma, user, { query: q, status, sort, page });
  const canCreate = hasPermission(user, "orders:create");
  const showMoney = hasPermission(user, "orders:view-prices");

  const linkWith = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), status, sort, ...patch });
    if (params.get("status") === "all") params.delete("status");
    if (params.get("sort") === "newest") params.delete("sort");
    const qs = params.toString();
    return qs ? `/orders?${qs}` : "/orders";
  };

  const filtered = q !== "" || status !== "all";

  return (
    <div>
      <Flash message={sp.saved === "archived" ? "تم حذف الأوردر (اتنقل للمحذوفة) ✓" : undefined} />
      {status === "archived" && (
        <p className="mb-3 rounded-2xl bg-well p-3 text-sm text-graphite">
          الأوردرات المحذوفة: مش ظاهرة في القوايم ولا حسابات العملاء ولا التقارير. افتح أي أوردر عشان تشوف مين حذفه وليه، أو ترجّعه.
        </p>
      )}
      <PageHeader
        title="كل الأوردرات"
        subtitle={result.total > 0 ? `${formatNumber(result.total)} أوردر` : undefined}
        action={
          canCreate && (
            <Link href="/orders/new" className={buttonVariants({ className: "shrink-0" })}>
              <Plus className="size-5" aria-hidden="true" />
              أوردر جديد
            </Link>
          )
        }
      />

      <div className="space-y-3">
        <SearchBox
          action="/orders"
          defaultValue={q}
          placeholder="دوّر برقم الأوردر أو اسم العميل أو الموبايل"
          hidden={{ status: status === "all" ? undefined : status, sort: sort === "newest" ? undefined : sort }}
        />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0" aria-label="فلترة بالحالة">
          {filters.map((f) => (
            <Link
              key={f.value}
              href={linkWith({ status: f.value, page: "1" })}
              aria-current={status === f.value ? "true" : undefined}
              className={cn(
                "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-[background-color,box-shadow] duration-200",
                status === f.value
                  ? f.value === "overdue"
                    ? "bg-danger-soft text-danger-ink"
                    : "bg-brand-solid text-white"
                  : "bg-surface text-ink border border-line hover:bg-well",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
        {hasPermission(user, "payments:view") && (
          <Link href="/orders/overdue-payments" className="inline-flex text-sm font-semibold text-red hover:underline">
            فلوس متأخرة بعد التسليم (١٠ أيام)
          </Link>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-graphite">الترتيب</span>
          <span className="inline-flex max-w-full overflow-x-auto rounded-full bg-surface p-1 border border-line [scrollbar-width:none]">
          {SORTS.map((s) => (
            <Link
              key={s.value}
              href={linkWith({ sort: s.value, page: "1" })}
              aria-current={sort === s.value ? "true" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center rounded-full px-3 whitespace-nowrap transition-colors",
                sort === s.value ? "bg-violet-soft font-semibold text-violet" : "text-graphite hover:text-ink",
              )}
            >
              {s.label}
            </Link>
          ))}
          </span>
        </div>
      </div>

      {result.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-violet-soft text-violet">
            <ClipboardList className="size-7" aria-hidden="true" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold">{filtered ? "مفيش أوردرات بالبحث ده" : "لسه مفيش أوردرات"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered ? "جرّب كلمة تانية أو شيل الفلتر." : "أول أوردر تسجله هيظهر هنا."}
          </p>
          {!filtered && canCreate && (
            <Link href="/orders/new" className={buttonVariants({ size: "lg", className: "mt-5" })}>
              <Plus className="size-5" aria-hidden="true" />
              سجّل أول أوردر
            </Link>
          )}
          {filtered && (
            <Link href="/orders" className={buttonVariants({ variant: "outline", className: "mt-5" })}>
              عرض كل الأوردرات
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Phones & tablets: cards */}
          <ul className="mt-4 grid grid-cols-1 gap-3 lg:hidden">
            {result.items.map((order) => (
              <li key={order.id}>
                <OrderCard order={order} showMoney={showMoney} />
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="mt-5 hidden overflow-hidden rounded-2xl bg-surface border border-line lg:block">
            <table className="w-full text-sm">
              <thead className="bg-well text-xs text-graphite">
                <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-start [&>th]:font-medium">
                  <th>رقم</th>
                  <th>العميل / الأوردر</th>
                  <th>الكمية</th>
                  <th>جاهز / اتسلم</th>
                  {showMoney && (
                    <>
                      <th>الإجمالي</th>
                      <th>المدفوع</th>
                      <th>المتبقي</th>
                    </>
                  )}
                  <th>الاستلام</th>
                  <th>التسليم</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {result.items.map((o) => (
                  <tr key={o.id} className={cn("hover:bg-well [&>td]:px-4 [&>td]:py-3", o.overdue && "bg-destructive/[0.03]")}>
                    <td dir="ltr" className="text-end font-medium text-muted-foreground">
                      <Link href={`/orders/${o.id}`} className="hover:text-primary">
                        {formatOrderNumber(o.number)}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/orders/${o.id}`} className="font-semibold hover:text-primary">
                        {o.customerName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{o.title}</div>
                    </td>
                    <td>
                      {formatNumber(o.quantity)} {UNIT_LABELS[o.unit]}
                    </td>
                    <td className="min-w-36">
                      <ProductionTrack size="sm" required={o.quantity} ready={o.production?.ready ?? 0} delivered={o.production?.delivered ?? 0} />
                      <span className="mt-1 block text-xs text-graphite">
                        جاهز {formatNumber(o.production?.ready ?? 0)} · اتسلم {formatNumber(o.production?.delivered ?? 0)}
                      </span>
                    </td>
                    {showMoney && (
                      <>
                        <td className="font-semibold">{o.money && formatMoneyString(o.money.totalPrice)}</td>
                        <td className="text-green-ink">{o.money && formatMoneyString(o.money.paid)}</td>
                        <td className="font-semibold text-primary">{o.money && formatMoneyString(o.money.outstanding)}</td>
                      </>
                    )}
                    <td className="text-graphite">{formatDateAr(o.receivedDate)}</td>
                    <td className={cn(o.overdue && "font-semibold text-destructive")}>{formatDateAr(o.deliveryDate)}</td>
                    <td>
                      <StatusBadge status={o.status} overdue={o.overdue} partlyDelivered={!!o.production && o.production.delivered > 0 && o.status !== "COMPLETED"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            basePath="/orders"
            params={{ q: q || undefined, status: status === "all" ? undefined : status, sort: sort === "newest" ? undefined : sort }}
          />
        </>
      )}
    </div>
  );
}
