import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Phone, Plus } from "lucide-react";
import { Flash } from "@/components/flash";
import { OrderCard } from "@/components/orders/order-card";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
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
      <PageHeader
        title={customer.name}
        backHref="/customers"
        backLabel="العملاء"
        subtitle={
          customer.phone ? (
            <a href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`} dir="ltr" className="inline-flex items-center gap-1.5">
              <Phone className="size-4" aria-hidden="true" />
              {customer.phone}
            </a>
          ) : undefined
        }
      />

      <section className="rounded-2xl border bg-card p-4">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-muted/60 p-3">
            <dt className="text-xs text-muted-foreground">إجمالي الأوردرات</dt>
            <dd className="mt-1 whitespace-nowrap text-sm font-bold sm:text-base">{formatMoneyString(customer.totals.agreed)}</dd>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <dt className="text-xs text-emerald-800">المدفوع</dt>
            <dd className="mt-1 whitespace-nowrap text-sm font-bold sm:text-base text-emerald-700">{formatMoneyString(customer.totals.paid)}</dd>
          </div>
          <div className="rounded-xl bg-brand-soft p-3">
            <dt className="text-xs text-primary">المتبقي عليه</dt>
            <dd className="mt-1 whitespace-nowrap text-sm font-bold sm:text-base text-primary">{formatMoneyString(customer.totals.outstanding)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">الأوردرات الملغية مش داخلة في الحساب.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {hasPermission(user, "orders:create") && (
            <Link href={`/orders/new?customer=${customer.id}`} className={buttonVariants({ size: "lg" })}>
              <Plus className="size-5" aria-hidden="true" />
              أوردر جديد
            </Link>
          )}
          {hasPermission(user, "customers:manage") && (
            <Link href={`/customers/${customer.id}/edit`} className={buttonVariants({ size: "lg", variant: "outline" })}>
              <Pencil className="size-5" aria-hidden="true" />
              تعديل البيانات
            </Link>
          )}
        </div>
      </section>

      {customer.notes && (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="mb-1 text-sm text-muted-foreground">ملاحظات</h2>
          <p className="whitespace-pre-wrap leading-relaxed">{customer.notes}</p>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-bold">أوردرات العميل ({customer.orders.length})</h2>
        {customer.orders.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
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
