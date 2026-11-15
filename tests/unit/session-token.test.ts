import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  getSessionCookieName,
  hashSessionToken,
  isWellFormedSessionToken,
} from "@/lib/auth/session-token";

describe("session tokens", () => {
  it("generates unique 256-bit base64url tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).toHaveLength(43);
    expect(a).not.toBe(b);
    expect(isWellFormedSessionToken(a)).toBe(true);
  });

  it("hashes deterministically to 64 hex chars and never stores the token", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("rejects malformed tokens", () => {
    expect(isWellFormedSessionToken("")).toBe(false);
    expect(isWellFormedSessionToken("abc")).toBe(false);
    expect(isWellFormedSessionToken("'; DROP TABLE users;--".padEnd(43, "x"))).toBe(false);
  });

  it("uses the __Host- prefix only for secure cookies", () => {
    expect(getSessionCookieName(true)).toBe("__Host-benuuprint_session");
    expect(getSessionCookieName(false)).toBe("benuuprint_session");
  });
});
