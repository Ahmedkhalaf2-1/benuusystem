import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveStaffPermissions, isGrantable } from "@/lib/auth/permissions";
import { LEGACY_STAFF_PERMISSIONS } from "../support/test-db";

const dir = path.resolve(__dirname, "../../prisma/migrations");
const migration = readdirSync(dir).find((d) => d.endsWith("_staff_permissions_order_visibility"))!;
const sql = readFileSync(path.join(dir, migration, "migration.sql"), "utf8");

describe("Phase 10 migration", () => {
  const granted = [...sql.matchAll(/'([a-z-]+:[a-z-]+)'/g)].map((m) => m[1]!);

  it("gives existing staff exactly the old STAFF role's capabilities — nothing more", () => {
    expect([...granted].sort()).toEqual([...LEGACY_STAFF_PERMISSIONS].sort());
    for (const p of granted) expect(isGrantable(p)).toBe(true);
    // Every legacy grant is actually in effect (no dependency silently missing).
    expect(effectiveStaffPermissions(granted).sort()).toEqual([...granted].sort());
    // Nothing the old STAFF role could not do.
    for (const p of ["costs:view", "expenses:view", "finance:view-summary", "documents:customer-financial", "orders:archive"]) expect(granted).not.toContain(p);
  });

  it("is additive, defaults orders to PRIVATE and only touches STAFF rows", () => {
    expect(sql).not.toMatch(/\bDROP\b|^\s*DELETE\b|ALTER COLUMN|RENAME|TRUNCATE/im);
    expect(sql).toMatch(/"visibility" "OrderVisibility" NOT NULL DEFAULT 'PRIVATE'/);
    expect(sql).toMatch(/UPDATE "users"[\s\S]*WHERE "role" = 'STAFF';/);
    expect(sql.match(/^UPDATE/gm)).toHaveLength(1);
  });
});
