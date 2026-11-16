import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Factory, HandCoins, Truck, type LucideIcon } from "lucide-react";
import { dueText } from "@/components/ds/date-stamp";
import { ProductIcon } from "@/components/ds/order-cards";
import { ProductionTrack } from "@/components/ds/production-track";
import { BackLink } from "@/components/page-header";
import { SearchBox } from "@/components/search-box";
import { requirePermission } from "@/lib/auth/current-user";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { formatMoneyString } from "@/lib/money";
import { formatNumber } from "@/lib/numbers";
import { formatOrderNumber, UNIT_LABELS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { listOrdersForAction, type OrderAction } from "@/server/services/order-service";

export const metadata: Metadata = { title: "اختار الأوردر" };

const ACTIONS: Record<
  OrderAction,
  { title: string; hint: string; empty: string; permission: Permission; path: string; icon: LucideIcon; hue: string; soft: string }
> = {
  production: {
    title: "تسجيل إنتاج",
    hint: "اختار الأوردر اللي خلص فيه شغل.",
    empty: "مفيش أوردرات مفتوحة لسه محتاجة إنتاج.",
    permission: "production:record",
    path: "production/new",
    icon: Factory,
    hue: "bg-brand-solid",
    soft: "text-blue-ink",
  },
  delivery: {
    title: "تسليم قطع",
    hint: "الأوردرات اللي عندها قطع جاهزة لسه متسلمتش.",
    empty: "مفيش قطع جاهزة مستنية تسليم دلوقتي.",
    permission: "deliveries:record",
    path: "deliveries/new",
    icon: Truck,
    hue: "bg-brand-solid",
    soft: "text-teal-ink",
  },
  payment: {
    title: "تحصيل دفعة",
    hint: "الأوردرات اللي لسه عليها فلوس.",
    empty: "مفيش أوردرات مفتوحة عليها فلوس.",
    permission: "payments:record",
    path: "payments/new",
    icon: HandCoins,
    hue: "bg-success-solid",
    soft: "text-green-ink",
  },
};

export default async function PickOrderPage(props: PageProps<"/orders/pick">) {
  const sp = await props.searchParams;
  const action = typeof sp.action === "string" && sp.action in ACTIONS ? (sp.action as OrderAction) : null;
  if (!action) notFound();
  const meta = ACTIONS[action];
  const user = await requirePermission(meta.permission);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const orders = hasPermission(user, "orders:view") ? await listOrdersForAction(prisma, user, action, q) : [];
  const Icon = meta.icon;

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href="/dashboard" label="الرئيسية" />
      <header className="mb-5 flex items-center gap-3">
        <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl text-white border border-line", meta.hue)}>
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="font-display text-[1.5rem] leading-[1.45] font-semibold tracking-[-0.02em]">{meta.title}</h1>
          <p className="mt-0.5 text-sm text-graphite">{meta.hint}</p>
        </div>
      </header>

      <SearchBox action="/orders/pick" defaultValue={q} placeholder="دوّر باسم العميل أو الأوردر أو رقمه" hidden={{ action }} />

      {orders.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-surface px-5 py-8 text-center text-[0.95rem] text-graphite border border-line">
          {q ? "مفيش أوردر بالاسم ده هنا." : meta.empty}
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {orders.map((o) => {
            const p = o.production ?? { ready: 0, delivered: 0 };
            const due = dueText(o.deliveryDate);
            const u = UNIT_LABELS[o.unit];
            const fact =
              action === "delivery"
                ? `${formatNumber(p.ready - p.delivered)} ${u} جاهزة`
                : action === "payment"
                  ? `المتبقي ${o.money ? formatMoneyString(o.money.outstanding) : ""}`
                  : `اتعمل ${formatNumber(p.ready)} من ${formatNumber(o.quantity)}`;
            return (
              <li key={o.id}>
                <Link
                  href={`/orders/${o.id}/${meta.path}`}
                  className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 border border-line transition-[transform,box-shadow] duration-150 hover:border-line-strong active:scale-[0.985]"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-well text-violet">
                    <ProductIcon productType={o.productType} className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display font-semibold">{o.customerName}</span>
                    <span className="block truncate text-sm text-graphite">
                      {o.title} <span dir="ltr" className="tabular text-xs">{formatOrderNumber(o.number)}</span>
                    </span>
                    <ProductionTrack className="mt-2" size="sm" required={o.quantity} ready={p.ready} delivered={p.delivered} />
                  </span>
                  <span className="shrink-0 text-end">
                    <span className={cn("block text-sm font-semibold", meta.soft)}>{fact}</span>
                    <span className={cn("block text-xs", due.tone === "late" ? "font-semibold text-red" : "text-graphite")}>{due.text}</span>
                  </span>
                  <ChevronLeft className="size-4 shrink-0 text-graphite" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
