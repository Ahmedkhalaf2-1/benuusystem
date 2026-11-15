import Link from "next/link";
import { BrandSymbol } from "@/components/brand/brand-mark";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { PublicUser } from "@/server/repositories/user-repository";
import { UserAvatar } from "./user-avatar";

/**
 * Top bar: the mark and name on phones, and the signed-in person — which opens
 * the account page («المزيد»), where sign-out lives behind a confirmation.
 */
export function AppHeader({ user }: { user: Pick<PublicUser, "name" | "role"> }) {
  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-line bg-canvas">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2.5 rounded-xl lg:hidden" aria-label="Benuuprint — الرئيسية">
          <BrandSymbol className="size-9" priority />
          <span dir="ltr" className="font-display text-[1.08rem] font-semibold tracking-[-0.02em] text-ink">
            Benuuprint
          </span>
        </Link>
        <Link
          href="/more"
          aria-label={`حسابي: ${user.name}`}
          className="ms-auto flex items-center gap-2.5 rounded-full py-1 ps-1 pe-1 transition-colors hover:bg-surface sm:pe-3"
        >
          <UserAvatar name={user.name} className="size-10" />
          <span className="hidden min-w-0 text-start leading-tight sm:block">
            <span className="block max-w-[12rem] truncate text-sm font-semibold">{user.name}</span>
            <span className="block text-xs text-graphite">{ROLE_LABELS[user.role]}</span>
          </span>
        </Link>
      </div>
    </header>
  );
}
