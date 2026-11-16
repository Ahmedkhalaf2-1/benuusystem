"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { MAIN_NAV, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Floating tab bar for phones. People who take orders get the raised
 * «أوردر جديد» button in the middle — the shop's most common action, under the thumb.
 */
export function BottomNav({ mainKeys, canCreateOrder = false }: { mainKeys: string[]; canCreateOrder?: boolean }) {
  const pathname = usePathname();
  const items = MAIN_NAV.filter((i) => mainKeys.includes(i.key));
  const half = Math.ceil(items.length / 2);
  const tab = (item: (typeof MAIN_NAV)[number]) => {
    const active = isNavItemActive(pathname, item.href);
    const Icon = item.icon;
    return (
      <li key={item.key}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group flex h-full flex-col items-center justify-center gap-0.5 text-[0.68rem] transition-colors",
            active ? "font-bold text-violet" : "font-medium text-graphite hover:text-ink",
          )}
        >
          <span
            className={cn(
              "flex h-8 w-12 items-center justify-center rounded-full transition-[background-color,transform] duration-300 ease-[var(--ease-out-expo)] group-active:scale-90",
              active && "bg-violet-soft",
            )}
          >
            <Icon className="size-[1.3rem]" strokeWidth={active ? 2.3 : 1.8} aria-hidden="true" />
          </span>
          {item.label}
        </Link>
      </li>
    );
  };
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed inset-x-3 bottom-[calc(0.6rem+env(safe-area-inset-bottom))] z-40 rounded-2xl border border-line bg-surface lg:hidden"
    >
      <ul
        className="mx-auto grid h-16 max-w-md"
        style={{ gridTemplateColumns: `repeat(${items.length + (canCreateOrder ? 1 : 0)}, minmax(0, 1fr))` }}
      >
        {items.slice(0, half).map(tab)}
        {canCreateOrder && (
          <li className="flex justify-center">
            <Link
              href="/orders/new"
              aria-current={pathname === "/orders/new" ? "page" : undefined}
              className="-mt-6 flex size-[3.6rem] items-center justify-center rounded-full bg-brand-solid text-white ring-4 ring-canvas transition-transform duration-200 active:scale-90"
            >
              <Plus className="size-7" strokeWidth={2.5} aria-hidden="true" />
              <span className="sr-only">أوردر جديد</span>
            </Link>
          </li>
        )}
        {items.slice(half).map(tab)}
      </ul>
    </nav>
  );
}
