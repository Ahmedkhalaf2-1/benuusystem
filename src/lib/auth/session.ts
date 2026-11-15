import "server-only";
import { cookies, headers } from "next/headers";
import { getEnv } from "@/lib/env";
import { getSessionCookieName } from "./session-token";
import { getClientIp } from "./request-context";

/** Cookie attributes: HttpOnly, SameSite=Lax, Secure in production, whole site. */
export function getSessionCookieConfig() {
  const secure = getEnv().SESSION_COOKIE_SECURE;
  return {
    name: getSessionCookieName(secure),
    options: {
      httpOnly: true,
      secure,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

export async function readSessionToken(): Promise<string | undefined> {
  // Read cookies() first: it marks the route as dynamic before any env/DB
  // access, so `next build` never tries to prerender authenticated pages.
  const store = await cookies();
  const { name } = getSessionCookieConfig();
  return store.get(name)?.value;
}

/** Only callable from Server Actions and Route Handlers. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const { name, options } = getSessionCookieConfig();
  (await cookies()).set(name, token, { ...options, expires: expiresAt });
}

/** Only callable from Server Actions and Route Handlers. */
export async function clearSessionCookie(): Promise<void> {
  const { name, options } = getSessionCookieConfig();
  (await cookies()).set(name, "", { ...options, maxAge: 0 });
}

export async function getRequestIp(): Promise<string> {
  return getClientIp(await headers());
}
