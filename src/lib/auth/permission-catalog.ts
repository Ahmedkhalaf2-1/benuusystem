import { PERMISSION_REQUIRES, STAFF_GRANTABLE, requiredPermissions, type GrantablePermission } from "./permissions";

/**
 * How staff permissions are presented to the owner: grouped by area, in plain
 * Arabic, each marked as "يشوف" (read) or "يعدّل / يسجّل" (change). Shared by
 * the server (validation, audit labels) and the permission editor.
 */
export type PermissionKind = "read" | "write";

export type PermissionInfo = {
  key: GrantablePermission;
  label: string;
  hint?: string;
  kind: PermissionKind;
  /** Shows money or wide company data — highlighted in the editor. */
  sensitive?: boolean;
};

export type PermissionGroup = { key: string; label: string; items: PermissionInfo[] };

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "orders",
    label: "الأوردرات",
    items: [
      { key: "orders:view", label: "يشوف الأوردرات", hint: "بس الأوردرات اللي ظاهرة له — من غير أي أسعار", kind: "read" },
      { key: "orders:view-prices", label: "يشوف أسعار الأوردرات", hint: "الإجمالي وسعر البنود والمدفوع والمتبقي", kind: "read", sensitive: true },
      { key: "orders:create", label: "يسجّل أوردر جديد", hint: "الأوردر اللي يسجله بيظهر له هو بس", kind: "write" },
      { key: "orders:edit", label: "يعدّل الأوردرات", kind: "write" },
      { key: "orders:archive", label: "يحذف أوردر لسه متسجلش عليه حاجة", kind: "write" },
    ],
  },
  {
    key: "production",
    label: "الإنتاج والتسليم",
    items: [
      { key: "production:view", label: "يشوف تقدّم الإنتاج", hint: "المراحل والقطع الجاهزة", kind: "read" },
      { key: "production:record", label: "يسجّل إنتاج وقطع جاهزة", kind: "write" },
      { key: "deliveries:view", label: "يشوف التسليمات", kind: "read" },
      { key: "deliveries:record", label: "يسجّل تسليم قطع", kind: "write" },
    ],
  },
  {
    key: "customers",
    label: "العملاء",
    items: [
      { key: "customers:view", label: "يشوف أسماء العملاء", kind: "read" },
      { key: "customers:view-contact", label: "يشوف أرقام تليفونات العملاء", kind: "read" },
      { key: "customers:manage", label: "يضيف ويعدّل بيانات العملاء", kind: "write" },
    ],
  },
  {
    key: "payments",
    label: "مدفوعات العملاء",
    items: [
      { key: "payments:view", label: "يشوف دفعات العملاء", kind: "read", sensitive: true },
      { key: "payments:record", label: "يستلم دفعة من عميل", kind: "write", sensitive: true },
      { key: "documents:customer-financial", label: "يطلع فواتير وكشوف حساب العملاء (PDF)", kind: "read", sensitive: true },
    ],
  },
  {
    key: "costs",
    label: "التكاليف والمصاريف والموردين",
    items: [
      { key: "costs:view", label: "يشوف تكاليف الأوردر", kind: "read", sensitive: true },
      { key: "costs:record", label: "يسجّل تكلفة على أوردر", hint: "من غير ما يشوف إجمالي التكاليف", kind: "write" },
      { key: "expenses:view", label: "يشوف المصاريف العامة", kind: "read", sensitive: true },
      { key: "expenses:record", label: "يسجّل مصروف", kind: "write" },
      { key: "suppliers:view", label: "يختار مورد (أسماء بس)", kind: "read" },
      { key: "suppliers:manage", label: "يضيف ويعدّل الموردين", kind: "write" },
      { key: "payables:pay", label: "يدفع لمورد أو مصروف", kind: "write", sensitive: true },
    ],
  },
  {
    key: "workers",
    label: "العمال (سجلات اليومية)",
    items: [
      { key: "workers:view", label: "يشوف أسماء العمال", hint: "من غير اليوميات ولا الحسابات", kind: "read" },
      { key: "work:record", label: "يسجّل حضور وشغل العمال", kind: "write" },
    ],
  },
  {
    key: "finance",
    label: "ملخص الفلوس",
    items: [{ key: "finance:view-summary", label: "يشوف فلوس الشهر في الرئيسية", hint: "اللي اتحصّل واتدفع في الشهر لكل الشركة", kind: "read", sensitive: true }],
  },
];

export const PERMISSION_INFO: Record<GrantablePermission, PermissionInfo> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.items).map((i) => [i.key, i]),
) as Record<GrantablePermission, PermissionInfo>;

/** Owner-only abilities, listed read-only in the editor so the owner knows they exist. */
export const OWNER_ONLY_LABELS = [
  "إدارة المستخدمين والصلاحيات",
  "ظهور الأوردرات للعمال",
  "تعديل سعر أوردر أو إلغاؤه",
  "إلغاء دفعات وتكاليف ومصاريف وسجلات إنتاج",
  "يوميات وحسابات العمال وقبضهم",
  "أرصدة الموردين",
  "التقارير المالية وهامش الأوردرات",
  "الخزنة وأرصدة الحسابات",
];

export type PermissionPreset = { key: string; label: string; description: string; permissions: GrantablePermission[] };

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    key: "production-readonly",
    label: "عامل إنتاج — عرض فقط",
    description: "يشوف الأوردرات اللي ظاهرة له والإنتاج والتسليم، من غير أسعار ومن غير ما يسجل حاجة.",
    permissions: ["orders:view", "production:view", "deliveries:view"],
  },
  {
    key: "production",
    label: "عامل إنتاج",
    description: "زي اللي فوق، ويسجل الإنتاج والقطع الجاهزة.",
    permissions: ["orders:view", "production:view", "production:record", "deliveries:view"],
  },
  {
    key: "delivery",
    label: "مسؤول تسليم",
    description: "يشوف الأوردرات والإنتاج ويسجل التسليم، من غير أسعار.",
    permissions: ["orders:view", "production:view", "deliveries:view", "deliveries:record", "customers:view", "customers:view-contact"],
  },
  {
    key: "front-desk",
    label: "استقبال أوردرات",
    description: "يسجل الأوردرات والعملاء ويستلم الدفعات، ويشوف الأسعار.",
    permissions: [
      "orders:view",
      "orders:view-prices",
      "orders:create",
      "orders:edit",
      "production:view",
      "deliveries:view",
      "customers:view",
      "customers:view-contact",
      "customers:manage",
      "payments:view",
      "payments:record",
    ],
  },
  { key: "none", label: "من غير صلاحيات", description: "يقدر يدخل بس مش هيشوف أي حاجة.", permissions: [] },
];

/** Adds everything `key` needs (used when the owner ticks a box). */
export function withDependencies(selected: readonly GrantablePermission[], key: GrantablePermission): GrantablePermission[] {
  const set = new Set(selected);
  set.add(key);
  for (const dep of requiredPermissions(key)) set.add(dep);
  return STAFF_GRANTABLE.filter((k) => set.has(k));
}

/** Removes `key` and everything that depends on it (used when the owner unticks a box). */
export function withoutDependents(selected: readonly GrantablePermission[], key: GrantablePermission): GrantablePermission[] {
  const set = new Set(selected);
  set.delete(key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...set]) {
      if ((PERMISSION_REQUIRES[k] ?? []).some((d) => !set.has(d))) {
        set.delete(k);
        changed = true;
      }
    }
  }
  return STAFF_GRANTABLE.filter((k) => set.has(k));
}

/** Grants missing a dependency (the server refuses these). */
export function missingDependencies(selected: readonly GrantablePermission[]): { key: GrantablePermission; needs: GrantablePermission[] }[] {
  const set = new Set(selected);
  return selected
    .map((key) => ({ key, needs: (PERMISSION_REQUIRES[key] ?? []).filter((d) => !set.has(d)) }))
    .filter((x) => x.needs.length > 0);
}
