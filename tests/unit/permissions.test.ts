import { describe, expect, it } from "vitest";
import { PERMISSIONS, hasPermission, permissionsForRole } from "@/lib/auth/permissions";

describe("permissions", () => {
  it("gives OWNER_ADMIN every permission", () => {
    expect(permissionsForRole("OWNER_ADMIN")).toEqual(PERMISSIONS);
  });

  it("limits STAFF", () => {
    expect(hasPermission({ role: "STAFF" }, "dashboard:view")).toBe(true);
    expect(hasPermission({ role: "STAFF" }, "orders:create")).toBe(true);
    expect(hasPermission({ role: "STAFF" }, "payments:record")).toBe(true);
    expect(hasPermission({ role: "STAFF" }, "orders:edit-price")).toBe(false);
    expect(hasPermission({ role: "STAFF" }, "orders:cancel")).toBe(false);
    expect(hasPermission({ role: "STAFF" }, "payments:void")).toBe(false);
    expect(hasPermission({ role: "STAFF" }, "users:manage")).toBe(false);
    expect(hasPermission({ role: "STAFF" }, "audit-logs:view")).toBe(false);
  });

  it("denies when there is no user", () => {
    expect(hasPermission(null, "dashboard:view")).toBe(false);
  });
});
