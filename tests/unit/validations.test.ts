import { describe, expect, it } from "vitest";
import { createOwnerAdminSchema, loginSchema } from "@/lib/validations/auth";

describe("loginSchema", () => {
  it("trims and lowercases the email", () => {
    const result = loginSchema.parse({ email: "  Owner@Benuu.COM ", password: "x" });
    expect(result.email).toBe("owner@benuu.com");
  });

  it("returns Arabic messages for empty fields", () => {
    const result = loginSchema.safeParse({ email: "", password: "" });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((issue) => issue.message);
    expect(messages).toContain("البريد الإلكتروني مطلوب");
    expect(messages).toContain("كلمة المرور مطلوبة");
  });

  it("rejects malformed emails with an Arabic hint", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "secret" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/بريدًا إلكترونيًا صحيحًا/);
  });

  it("caps password length to protect the hasher", () => {
    const result = loginSchema.safeParse({ email: "a@b.co", password: "x".repeat(129) });
    expect(result.success).toBe(false);
  });
});

describe("createOwnerAdminSchema", () => {
  it("requires at least 8 password characters", () => {
    const result = createOwnerAdminSchema.safeParse({
      name: "أحمد",
      email: "a@b.co",
      password: "short",
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(["password"]);
  });

  it("accepts valid input", () => {
    expect(
      createOwnerAdminSchema.safeParse({ name: "أحمد خلف", email: "a@b.co", password: "long-enough-1" })
        .success,
    ).toBe(true);
  });
});
