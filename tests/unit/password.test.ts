import { describe, expect, it } from "vitest";
import { getDummyPasswordHash, hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("produces Argon2id hashes with the configured cost", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "Correct horse battery")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("treats a malformed hash as a failed verification", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });

  it("dummy hash never matches user input", async () => {
    expect(await verifyPassword(await getDummyPasswordHash(), "")).toBe(false);
  });
});
