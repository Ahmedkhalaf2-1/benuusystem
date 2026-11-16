import "dotenv/config";
import { describe, expect, it } from "vitest";
import { PERMISSION_GROUPS, PERMISSION_PRESETS, missingDependencies, withDependencies, withoutDependents } from "@/lib/auth/permission-catalog";
import {
  PERMISSIONS,
  PERMISSION_REQUIRES,
  STAFF_GRANTABLE,
  assertPermission,
  effectiveStaffPermissions,
  hasPermission,
  permissionsFor,
  type Permission,
} from "@/lib/auth/permissions";

const OWNER_ONLY: Permission[] = [
  "users:manage",
  "audit-logs:view",
  "orders:edit-price",
  "orders:cancel",
  "orders:manage-access",
  "payments:void",
  "finance:void",
  "finance:reports",
  "suppliers:view-balances",
  "workers:manage",
  "workers:view-pay",
  "workers:pay",
  "workers:correct",
  "labor:view",
  "production:correct",
];

const staff = (permissions: string[]) => ({ role: "STAFF" as const, permissions });

describe("permissions", () => {
  it("gives OWNER_ADMIN every permission regardless of the stored list", () => {
    expect(permissionsFor({ role: "OWNER_ADMIN", permissions: [] })).toEqual(PERMISSIONS);
    for (const p of PERMISSIONS) expect(hasPermission({ role: "OWNER_ADMIN" }, p)).toBe(true);
  });

  it("denies everything but the home screen to a new staff account", () => {
    expect(permissionsFor(staff([]))).toEqual(["dashboard:view"]);
    for (const p of PERMISSIONS) if (p !== "dashboard:view") expect(hasPermission(staff([]), p)).toBe(false);
  });

  it("never lets a staff row grant owner-only or unknown permissions", () => {
    const sneaky = staff([...OWNER_ONLY, "everything", "orders:view"]);
    for (const p of OWNER_ONLY) expect(hasPermission(sneaky, p)).toBe(false);
    expect(hasPermission(sneaky, "orders:view")).toBe(true);
    for (const p of OWNER_ONLY) expect((STAFF_GRANTABLE as readonly string[]).includes(p)).toBe(false);
  });

  it("never infers prices from viewing orders, or writes from reads", () => {
    const viewer = staff(["orders:view", "production:view", "deliveries:view"]);
    expect(hasPermission(viewer, "orders:view")).toBe(true);
    expect(hasPermission(viewer, "orders:view-prices")).toBe(false);
    expect(hasPermission(viewer, "production:record")).toBe(false);
    expect(hasPermission(viewer, "deliveries:record")).toBe(false);
    expect(hasPermission(viewer, "orders:edit")).toBe(false);
    expect(hasPermission(viewer, "payments:view")).toBe(false);
  });

  it("ignores a write whose read was not granted", () => {
    // e.g. a hand-edited row: recording deliveries without seeing deliveries or orders.
    expect(hasPermission(staff(["deliveries:record"]), "deliveries:record")).toBe(false);
    expect(hasPermission(staff(["payments:record", "payments:view", "orders:view"]), "payments:record")).toBe(false);
    expect(effectiveStaffPermissions(["orders:view-prices"])).toEqual([]);
  });

  it("supports the read-only production worker", () => {
    const preset = PERMISSION_PRESETS.find((p) => p.key === "production-readonly")!;
    expect(preset.label).toBe("عامل إنتاج — عرض فقط");
    const worker = staff(preset.permissions);
    expect(permissionsFor(worker)).toEqual(["dashboard:view", "orders:view", "production:view", "deliveries:view"]);
  });

  it("presets and the catalogue only use grantable keys with complete dependencies", () => {
    for (const preset of PERMISSION_PRESETS) expect(missingDependencies(preset.permissions)).toEqual([]);
    const listed = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)).sort();
    expect(listed).toEqual([...STAFF_GRANTABLE].sort());
    for (const deps of Object.values(PERMISSION_REQUIRES)) for (const d of deps ?? []) expect(STAFF_GRANTABLE).toContain(d);
  });

  it("editor helpers add what a write needs and drop what depends on a removed read", () => {
    expect(withDependencies([], "deliveries:record")).toEqual(["orders:view", "deliveries:view", "deliveries:record"]);
    expect(withoutDependents(["orders:view", "orders:view-prices", "payments:view", "payments:record", "production:view"], "orders:view-prices")).toEqual([
      "orders:view",
      "production:view",
    ]);
  });

  it("assertPermission throws FORBIDDEN, and nobody is no one", () => {
    expect(() => assertPermission(staff([]), "orders:view")).toThrow();
    expect(hasPermission(null, "dashboard:view")).toBe(false);
  });
});
