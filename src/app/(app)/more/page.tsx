import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, HardHat, UsersRound } from "lucide-react";
import { SoonBadge } from "@/components/coming-soon";
import { LogoutButton } from "@/components/layout/logout-button";
import { UserAvatar } from "@/components/layout/user-avatar";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "المزيد" };

const SECTIONS: { key: string; label: string; description: string; icon: typeof HardHat; href?: string }[] = [
  { key: "customers", label: "العملاء", description: "بيانات العملاء ومدفوعاتهم", icon: UsersRound, href: "/customers" },
  { key: "workers", label: "العمال", description: "بيانات العمال وحساباتهم", icon: HardHat },
];

export default async function MorePage() {
  const user = await requireUser();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">المزيد</h1>

      <section className="flex items-center gap-3 rounded-2xl border bg-card p-4">
        <UserAvatar name={user.name} className="size-12 text-base" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{user.name}</p>
          <p dir="ltr" className="truncate text-end text-sm text-muted-foreground">
            {user.email}
          </p>
          <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
        </div>
      </section>

      <section aria-labelledby="sections-heading">
        <h2 id="sections-heading" className="mb-3 text-lg font-bold">
          الأقسام
        </h2>
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {SECTIONS.map(({ key, label, description, icon: Icon, href }) => {
            const body = (
              <>
                <span className={href ? "flex size-10 items-center justify-center rounded-xl bg-brand-soft text-primary" : "flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                {href ? <ChevronLeft className="size-5 text-muted-foreground" aria-hidden="true" /> : <SoonBadge />}
              </>
            );
            return (
              <li key={key}>
                {href ? (
                  <Link href={href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-16 items-center gap-3 px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <LogoutButton variant="full" />
    </div>
  );
}
