import { describe, expect, it } from "vitest";
import { productionConfigProblems } from "@/lib/env";

const base = { NODE_ENV: "production" };

describe("production startup configuration", () => {
  it("accepts a dedicated production database URL", () => {
    expect(productionConfigProblems({ ...base, DATABASE_URL: "postgresql://benuuprint_app:Zx9-long-random@127.0.0.1:5432/benuuprint?schema=public" })).toEqual([]);
  });

  it("accepts a Unix-socket (peer auth) URL without a password", () => {
    expect(productionConfigProblems({ ...base, DATABASE_URL: "postgresql://benuuprint_app@localhost/benuuprint?host=/var/run/postgresql" })).toEqual([]);
  });

  it("refuses to start without DATABASE_URL", () => {
    const problems = productionConfigProblems({ ...base });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^DATABASE_URL/);
  });

  it("refuses a non-postgres URL", () => {
    expect(productionConfigProblems({ ...base, DATABASE_URL: "mysql://u:p@h/db" })[0]).toMatch(/postgresql/);
  });

  it("refuses the local development password", () => {
    const problems = productionConfigProblems({ ...base, DATABASE_URL: "postgresql://benuuprint:change-me-local-dev@db:5432/benuuprint" });
    expect(problems.join()).toMatch(/development password/);
  });

  it("refuses a test database", () => {
    const problems = productionConfigProblems({ ...base, DATABASE_URL: "postgresql://u:secret-pass@127.0.0.1:5432/benuuprint_test?schema=public" });
    expect(problems.join()).toMatch(/test database/);
  });

  it("refuses an invalid SESSION_COOKIE_SECURE value", () => {
    const problems = productionConfigProblems({ ...base, DATABASE_URL: "postgresql://u:secret-pass@h/db", SESSION_COOKIE_SECURE: "yes" });
    expect(problems.join()).toMatch(/SESSION_COOKIE_SECURE/);
  });

  it("never echoes secret values in its messages", () => {
    const problems = productionConfigProblems({ ...base, DATABASE_URL: "postgresql://u:change-me-local-dev@h/benuuprint_test" });
    expect(problems.join()).not.toContain("change-me-local-dev@");
    expect(problems.join()).not.toContain("u:");
  });
});
