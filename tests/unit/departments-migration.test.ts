import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { permissionsFor } from "@/lib/auth/permissions";
import { spansDepartments, suggestDepartmentId, suggestDepartmentKey } from "@/lib/departments/suggest";

const dir = path.resolve(__dirname, "../../prisma/migrations");
const migration = readdirSync(dir).find((d) => d.endsWith("_departments_partners"))!;
const sql = readFileSync(path.join(dir, migration, "migration.sql"), "utf8");

describe("Phase 2 migration", () => {
  it("is additive: nothing dropped, deleted, renamed or retyped", () => {
    expect(sql).not.toMatch(/\bDROP\b|^\s*DELETE\b|ALTER COLUMN|RENAME|TRUNCATE/im);
    expect(sql).toMatch(/ALTER TYPE "Role" ADD VALUE 'PARTNER'/);
    expect(sql).toMatch(/ALTER TABLE "order_groups" ADD COLUMN\s+"department_id" UUID;/);
  });

  it("only fills the new department column, and grants nobody anything", () => {
    const updates = sql.match(/^UPDATE "[a-z_]+"/gm) ?? [];
    expect(updates).toEqual(['UPDATE "order_groups"']);
    expect(sql).toMatch(/SET "department_id" = dep\.id/);
    expect(sql).not.toMatch(/INSERT INTO "department_members"/);
    expect(sql).not.toMatch(/"users"[^;]*SET/);
  });

  it("seeds the four departments", () => {
    for (const [key, name] of [["EMBROIDERY", "تطريز"], ["COVERS", "كوفرات"], ["PRINTING", "طباعة"], ["GARMENTS", "ملابس / منتج كامل"]]) {
      expect(sql).toContain(`'${key}', '${name}'`);
    }
  });
});

describe("department suggestion rule", () => {
  it("follows covers words, then the primary work type", () => {
    expect(suggestDepartmentKey({ name: "جراب آيفون", designs: [{ operation: "DTF" }] })).toBe("COVERS");
    expect(suggestDepartmentKey({ name: "", productType: "كوفر موبايل" })).toBe("COVERS");
    expect(suggestDepartmentKey({ name: "لوجو", designs: [{ operation: "EMBROIDERY" }] })).toBe("EMBROIDERY");
    expect(suggestDepartmentKey({ designs: [{ operation: "SCREEN_PRINT" }] })).toBe("PRINTING");
    expect(suggestDepartmentKey({ designs: [] })).toBe("GARMENTS");
    expect(suggestDepartmentKey({ operations: ["MANUFACTURING", "DTF"] })).toBe("GARMENTS");
    expect(suggestDepartmentKey({ operations: ["EMBROIDERY"] })).toBe("EMBROIDERY");
    // Mixed work: the item goes with its FIRST design (it is never split or doubled).
    expect(suggestDepartmentKey({ designs: [{ operation: "DTF" }, { operation: "EMBROIDERY" }] })).toBe("PRINTING");
    expect(spansDepartments({ designs: [{ operation: "DTF" }, { operation: "EMBROIDERY" }] })).toBe(true);
    expect(spansDepartments({ designs: [{ operation: "DTF" }, { operation: "SCREEN_PRINT" }] })).toBe(false);
  });

  it("only suggests an offered (active) department", () => {
    const options = [{ id: "a", key: "PRINTING", name: "طباعة" }];
    expect(suggestDepartmentId(options, { designs: [{ operation: "DTF" }] })).toBe("a");
    expect(suggestDepartmentId(options, { designs: [{ operation: "EMBROIDERY" }] })).toBeNull();
  });
});

describe("partner backstop", () => {
  it("a PARTNER row never yields a permission, whatever is stored", () => {
    expect(permissionsFor({ role: "PARTNER", permissions: ["orders:view", "users:manage", "dashboard:view"] })).toEqual([]);
  });
});

describe("Phase 3 migration", () => {
  const p3 = readdirSync(dir).find((d) => d.endsWith("_department_finance_presets"))!;
  const sql3 = readFileSync(path.join(dir, p3, "migration.sql"), "utf8");

  it("is additive and needs no enum ownership", () => {
    expect(sql3).not.toMatch(/\bDROP\b|^\s*DELETE\b|^\s*UPDATE\b|ALTER COLUMN|RENAME|TRUNCATE|ALTER TYPE/im);
    // New switches default OFF: nobody gains access.
    expect(sql3).toMatch(/"can_view_collections" BOOLEAN NOT NULL DEFAULT false/);
    expect(sql3).toMatch(/"can_view_settlements" BOOLEAN NOT NULL DEFAULT false/);
    expect(sql3).toMatch(/"hidden_from_departments" BOOLEAN NOT NULL DEFAULT false/);
  });

  it("guards the new money columns and seeds the six presets", () => {
    expect(sql3).toMatch(/CHECK \("amount" > 0\)/);
    expect(sql3).toMatch(/CHECK \(\("quantity" IS NULL\) = \("unit_cost" IS NULL\)\)/);
    for (const name of ["تيشيرت", "هودي", "سويت شيرت", "بولو", "كاب", "شنطة"]) expect(sql3).toContain(`'${name}'`);
  });
});
