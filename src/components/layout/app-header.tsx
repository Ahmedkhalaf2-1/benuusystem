import Link from "next/link";
import { BrandMark, BrandName } from "@/components/brand/brand-mark";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { PublicUser } from "@/server/repositories/user-repository";
import { LogoutButton } from "./logout-button";
import { UserAvatar } from "./user-avatar";

/** Top bar on mobile; on desktop the sidebar carries the brand, so only the user block shows. */
export function AppHeader({ user }: { user: Pick<PublicUser, "name" | "role"> }) {
  return (
    <header className="pt-safe sticky top-0 z-30 border-b bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2.5 lg:hidden" aria-label="Benuuprint — الرئيسية">
          <BrandMark className="size-9" />
          <BrandName className="text-lg" />
        </Link>

        <div className="ms-auto flex items-center gap-2">
          <UserAvatar name={user.name} />
          <div className="min-w-0 leading-tight">
            <p className="max-w-[9rem] truncate text-sm font-semibold sm:max-w-xs">{user.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
          </div>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
