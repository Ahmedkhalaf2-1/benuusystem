import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, HardHat, Receipt, Truck, UsersRound } from "lucide-react";
import { HueIcon, type Hue } from "@/components/ds/primitives";
import { SoonBadge } from "@/components/coming-soon";
import { LogoutButton } from "@/components/layout/logout-button";
import { UserAvatar } from "@/components/layout/user-avatar";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission, ROLE_LABELS, type Permission } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "المزيد" };

const SECTIONS: { key: string; label: string; description: string; icon: typeof HardHat; href?: string; permission: Permission; hue: Hue }[] = [
  { key: "customers", label: "العملاء", description: "بيانات العملاء ومدفوعاتهم", icon: UsersRound, href: "/customers", permission: "customers:view", hue: "violet" },
  { key: "suppliers", label: "الموردين", description: "اللي اشترينا منهم واللي لسه ليهم", icon: Truck, href: "/suppliers", permission: "suppliers:view-balances", hue: "blue" },
  { key: "expenses", label: "المصاريف", description: "إيجار، كهرباء، مستلزمات…", icon: Receipt, href: "/expenses", permission: "expenses:view", hue: "amber" },
  { key: "workers", label: "العمال", description: "اليومية والشغل والحساب", icon: HardHat, href: "/workers", permission: "workers:view", hue: "rose" },
];

export default async function MorePage() {
  const user = await requireUser();

  const sections = SECTIONS.filter((section) => hasPermission(user, section.permission));
  return (
    <div className="space-y-6">
      {/* Who is signed in */}
      <section className="stage relative overflow-hidden rounded-[1.9rem] p-5 text-white shadow-[var(--shadow-violet)]">
        <span aria-hidden="true" className="pointer-events-none absolute -top-14 -end-10 size-44 rounded-full bg-[#ff7aa8]/25 blur-3xl" />
        <div className="relative flex items-center gap-3.5">
          <UserAvatar name={user.name} className="size-14 text-lg" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold">{user.name}</h1>
            <p dir="ltr" className="truncate text-end text-sm text-white/70">
              {user.email}
            </p>
            <span className="mt-1 inline-flex h-6 items-center rounded-full bg-white/15 px-2.5 text-xs font-semibold ring-1 ring-white/15">{ROLE_LABELS[user.role]}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="sections-heading">
        <h2 id="sections-heading" className="mb-3 font-display text-[1.15rem] font-semibold">
          الأقسام
        </h2>
        {sections.length === 0 ? (
          <p className="rounded-[1.4rem] bg-surface p-5 text-sm text-graphite shadow-[var(--shadow-card)]">مفيش أقسام تانية متاحة لحسابك.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {sections.map(({ key, label, description, icon, href, hue }) => {
              const body = (
                <>
                  <HueIcon icon={icon} hue={hue} />
                  <span className="mt-auto block">
                    <span className="flex items-center justify-between font-display font-semibold">
                      {label}
                      {href ? <ChevronLeft className="size-4 text-graphite" aria-hidden="true" /> : <SoonBadge />}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-graphite">{description}</span>
                  </span>
                </>
              );
              return (
                <li key={key}>
                  {href ? (
                    <Link
                      href={href}
                      className="flex h-full min-h-36 flex-col gap-3 rounded-[1.4rem] bg-surface p-4 shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-200 hover:shadow-[var(--shadow-lift)] active:scale-[0.97]"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex h-full min-h-36 flex-col gap-3 rounded-[1.4rem] bg-surface p-4 opacity-70 shadow-[var(--shadow-card)]">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <LogoutButton />
    </div>
  );
}
