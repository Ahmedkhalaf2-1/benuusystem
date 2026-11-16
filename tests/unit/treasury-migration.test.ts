import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(__dirname, "../../prisma/migrations");
const sql = readFileSync(path.join(dir, readdirSync(dir).find((d) => d.endsWith("_treasury_accounts"))!, "migration.sql"), "utf8");

describe("treasury migration", () => {
  it("is additive: no drops, deletes, updates or backfills; payment accounts start NULL", () => {
    expect(sql).not.toMatch(/\bDROP\b|^\s*DELETE\b|^\s*UPDATE\b|^\s*INSERT\b|ALTER COLUMN|RENAME|TRUNCATE/im);
    expect(sql).toMatch(/ALTER TABLE "order_payments" ADD COLUMN\s+"account_id" UUID;/);
    expect(sql).toMatch(/ALTER TABLE "outgoing_payments" ADD COLUMN\s+"account_id" UUID;/);
  });
  it("enforces movement integrity in the database", () => {
    expect(sql).toMatch(/treasury_movements_amount_positive/);
    expect(sql).toMatch(/"to_account_id" <> "account_id"/);
  });
});
