import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Phone, Plus } from "lucide-react";
import { Flash } from "@/components/flash";
import { OrderCard } from "@/components/orders/order-card";
import { BackLink } from "@/components/page-header";
import { UserAvatar } from "@/components/layout/user-avatar";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatDateTimeAr } from "@/lib/dates";
import { formatMoneyString } from "@/lib/money";
import { getCustomerDetails } from "@/server/services/customer-service";

export const metadata: Metadata = { title: "العميل" };

const FLASH: Record<string, string> = { created: "تم حفظ العميل ✓", updated: "تم حفظ التعديلات ✓" };

export default async function CustomerPage(props: PageProps<"/customers/[id]">) {
  const user = await requirePermission("customers:view");
  const { id } = await props.params;
  const { saved } = await props.searchParams;
  const customer = /^[0-9a-f-]{36}$/i.test(id) ? await getCustomerDetails(prisma, user, id) : null;
  if (!customer) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Flash message={typeof saved === "string" ? FLASH[saved] : undefined} />
      <BackLink href="/customers" label="العملاء" />
      <section className="stage relative overflow-hidden rounded-[1.9rem] p-5 text-white shadow-[var(--shadow-violet)]">
        <span aria-hidden="true" className="pointer-events-none absolute -top-14 -end-10 size-44 rounded-full bg-[#ff7aa8]/25 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-3.5">
            <UserAvatar name={customer.name} className="size-14 text-lg" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-[1.6rem] leading-tight font-semibold tracking-[-0.02em]">{customer.name}</h1>
              {customer.phone && (
                <a
                  href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`}
                  dir="ltr"
                  className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-semibold ring-1 ring-white/15 hover:bg-white/25"
                >
                  <Phone className="size-3.5" aria-hidden="true" />
                  {customer.phone}
                </a>
              )}
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-2">
            {[
              { label: "إجمالي الأوردرات", value: customer.totals.agreed, tone: "" },
              { label: "المدفوع", value: customer.totals.paid, tone: "text-[#7ee2a8]" },
              { label: "المتبقي عليه", value: customer.totals.outstanding, tone: "" },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl bg-white/10 px-3 py-2.5 ring-1 ring-white/12">
                <dt className="text-[0.7rem] text-white/70">{m.label}</dt>
                <dd className={`tabular mt-0.5 font-display text-[0.95rem] font-semibold whitespace-nowrap ${m.tone}`}>{formatMoneyString(m.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[0.7rem] text-white/60">الأوردرات الملغية مش داخلة في الحساب.</p>
          <div className="mt-4 flex gap-2">
            {hasPermission(user, "orders:create") && (
              <Link
                href={`/orders/new?customer=${customer.id}`}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white font-display font-semibold text-violet shadow-[0_10px_24px_-12px_rgb(0_0_0/0.5)] transition-transform active:scale-[0.97]"
              >
                <Plus className="size-5" aria-hidden="true" />
                أوردر جديد
              </Link>
            )}
            {hasPermission(user, "customers:manage") && (
              <Link
                href={`/customers/${customer.id}/edit`}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white/15 font-display font-semibold ring-1 ring-white/20 transition-transform hover:bg-white/25 active:scale-[0.97]"
              >
                <Pencil className="size-5" aria-hidden="true" />
                تعديل البيانات
              </Link>
            )}
          </div>
        </div>
      </section>

      {customer.notes && (
        <section className="rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4">
          <h2 className="mb-1 text-xs font-semibold text-amber-ink">ملاحظات</h2>
          <p className="whitespace-pre-wrap leading-relaxed">{customer.notes}</p>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-[1.15rem] font-semibold">أوردرات العميل ({customer.orders.length})</h2>
        {customer.orders.length === 0 ? (
          <p className="rounded-[1.6rem] border-2 border-dashed border-[#d9d2ea] bg-surface/60 p-6 text-center text-sm text-muted-foreground">
            لسه مفيش أوردرات للعميل ده.
          </p>
        ) : (
          <ul className="grid gap-3">
            {customer.orders.map((order) => (
              <li key={order.id}>
                <OrderCard order={order} hideCustomer />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-xs text-muted-foreground">
        اتسجل بواسطة {customer.createdByName} · {formatDateTimeAr(customer.createdAt)}
      </p>
    </div>
  );
}
