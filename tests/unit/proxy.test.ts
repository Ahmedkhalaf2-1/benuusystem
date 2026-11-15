import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const BASE = "http://localhost:3000";
const TOKEN = "a".repeat(43);

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, BASE), {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("proxy route protection (optimistic layer)", () => {
  it("redirects unauthenticated page requests to /login", () => {
    for (const path of ["/dashboard", "/orders", "/more", "/"]) {
      const response = proxy(request(path));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    }
  });

  it("answers unauthenticated API requests with 401 JSON", async () => {
    const response = proxy(request("/api/me"));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("lets public paths through", () => {
    expect(proxy(request("/login")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/api/health")).headers.get("x-middleware-next")).toBe("1");
  });

  it("lets requests with a session cookie through and refreshes the cookie", () => {
    const response = proxy(request("/dashboard", `__Host-benuuprint_session=${TOKEN}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain(`__Host-benuuprint_session=${TOKEN}`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
  });
});
