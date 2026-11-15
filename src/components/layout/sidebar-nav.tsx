"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/brand/brand-mark";
import { MAIN_NAV, SIDEBAR_EXTRA_NAV, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Desktop sidebar (≥ lg). Sits on the right because the layout is RTL. */
/** `extraKeys`: which extra links this user may see (decided on the server). */
export function SidebarNav({ extraKeys }: { extraKeys: string[] }) {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-hairline bg-surface lg:flex">
      <Link href="/dashboard" className="flex h-16 items-center gap-2.5 px-6" aria-label="Benuuprint — الرئيسية">
        <BrandMark className="size-9 rounded-[11px] shadow-[var(--shadow-violet)]" />
        <span dir="ltr" className="font-display text-[1.1rem] font-semibold tracking-[-0.02em] text-ink">
          Benuuprint
        </span>
      </Link>
      <nav aria-label="التنقل الرئيسي" className="flex-1 px-3 py-4">
        <ul className="space-y-1">
          {[...MAIN_NAV.slice(0, 2), ...SIDEBAR_EXTRA_NAV.filter((i) => extraKeys.includes(i.key)), ...MAIN_NAV.slice(2)].map((item) => {
            const active = isNavItemActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-11 items-center gap-3 rounded-xl px-3.5 text-[0.95rem] transition-colors",
                    active
                      ? "bg-violet-soft font-semibold text-violet"
                      : "font-medium text-graphite hover:bg-well hover:text-ink",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
