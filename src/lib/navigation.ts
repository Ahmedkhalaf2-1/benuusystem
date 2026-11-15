import {
  CalendarRange,
  ClipboardList,
  HardHat,
  House,
  LayoutGrid,
  PlusCircle,
  Receipt,
  Truck,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for navigation and module availability.
 * When a module ships in a later phase, set `available: true` and give it an
 * `href`; every menu, tile and "قريبًا" badge updates from here.
 */
export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
};

/** Bottom bar (mobile) and sidebar (desktop). Always routable. */
export const MAIN_NAV: readonly NavItem[] = [
  { key: "home", label: "الرئيسية", href: "/dashboard", icon: House },
  { key: "orders", label: "الأوردرات", href: "/orders", icon: ClipboardList },
  { key: "accounts", label: "الحسابات", href: "/accounts", icon: Wallet },
  { key: "more", label: "المزيد", href: "/more", icon: LayoutGrid },
];

/** Extra sidebar entries on desktop (phones reach them from the dashboard / المزيد). */
export const SIDEBAR_EXTRA_NAV: readonly NavItem[] = [
  { key: "customers", label: "العملاء", href: "/customers", icon: UsersRound },
  { key: "suppliers", label: "الموردين", href: "/suppliers", icon: Truck },
  { key: "expenses", label: "المصاريف", href: "/expenses", icon: Receipt },
];

export type QuickAction = {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Only set once the real feature exists. */
  href?: string;
};

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: "new-order", label: "أوردر جديد", description: "تسجيل أوردر لعميل", icon: PlusCircle, href: "/orders/new" },
  { key: "orders", label: "كل الأوردرات", description: "متابعة حالة الأوردرات", icon: ClipboardList, href: "/orders" },
  { key: "new-expense", label: "سجل مصروف", description: "إيجار، كهرباء، مستلزمات…", icon: Receipt, href: "/expenses/new" },
  { key: "workers", label: "العمال", description: "بيانات العمال وحساباتهم", icon: HardHat },
  { key: "customers", label: "العملاء", description: "بيانات العملاء ومدفوعاتهم", icon: UsersRound, href: "/customers" },
  { key: "monthly-accounts", label: "حسابات الشهر", description: "ملخص دخل ومصروفات الشهر", icon: CalendarRange },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
