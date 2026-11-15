"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MAIN_NAV, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Fixed bottom tab bar for phones; hidden on desktop (sidebar takes over). */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-4">
        {MAIN_NAV.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-brand-soft",
                  )}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
