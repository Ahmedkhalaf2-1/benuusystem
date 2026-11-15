import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, HardHat, Receipt, Truck, UsersRound } from "lucide-react";
import { HueIcon, type Hue } from "@/components/ds/primitives";
import { SoonBadge } from "@/components/coming-soon";
import { LogoutButton } from "@/components/layout/logout-button";
import { ThemeSelect } from "@/components/theme/theme-select";
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
      <section className="stage relative overflow-hidden rounded-2xl p-5 text-on-panel">
        <div className="relative flex items-center gap-3.5">
          <UserAvatar name={user.name} className="size-14 text-lg" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold">{user.name}</h1>
            <p dir="ltr" className="truncate text-end text-sm text-on-panel-muted">
              {user.email}
            </p>
            <span className="mt-1 inline-flex h-6 items-center rounded-full bg-panel-2 px-2.5 text-xs font-semibold ring-1 ring-panel-line">{ROLE_LABELS[user.role]}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="sections-heading">
        <h2 id="sections-heading" className="mb-3 font-display text-[1.15rem] font-semibold">
          الأقسام
        </h2>
        {sections.length === 0 ? (
          <p className="rounded-2xl bg-surface p-5 text-sm text-graphite border border-line">مفيش أقسام تانية متاحة لحسابك.</p>
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
                      className="flex h-full min-h-36 flex-col gap-3 rounded-2xl bg-surface p-4 border border-line transition-[transform,box-shadow] duration-200 hover:border-line-strong active:scale-[0.97]"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex h-full min-h-36 flex-col gap-3 rounded-2xl bg-surface p-4 opacity-70 border border-line">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <ThemeSelect />
      </section>

      <LogoutButton />
    </div>
  );
}
