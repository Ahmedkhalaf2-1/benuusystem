"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark, BrandName } from "@/components/brand/brand-mark";
import { MAIN_NAV, SIDEBAR_EXTRA_NAV, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Desktop sidebar (≥ lg). Sits on the right because the layout is RTL. */
export function SidebarNav() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e bg-surface lg:flex">
      <Link href="/dashboard" className="flex h-16 items-center gap-2.5 px-6" aria-label="Benuuprint — الرئيسية">
        <BrandMark className="size-9" />
        <BrandName className="text-lg" />
      </Link>
      <nav aria-label="التنقل الرئيسي" className="flex-1 px-3 py-4">
        <ul className="space-y-1">
          {[...MAIN_NAV.slice(0, 2), ...SIDEBAR_EXTRA_NAV, ...MAIN_NAV.slice(2)].map((item) => {
            const active = isNavItemActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium transition-colors",
                    active
                      ? "bg-brand-soft text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
