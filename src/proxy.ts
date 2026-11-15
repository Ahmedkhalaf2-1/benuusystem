import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAMES,
  SESSION_DURATION_MS,
} from "@/lib/auth/session-token";

/**
 * Optimistic route protection (no database access here).
 *
 * - No session cookie on a protected path → redirect to /login (pages) or 401 (API).
 * - Cookie present → let it through and slide the cookie's lifetime.
 *
 * This is only a fast first filter. The real check — session exists, not
 * expired, user active — happens on the server in `requireUser()` /
 * `requireApiUser()` for every page, action and API route.
 */
const PUBLIC_PATHS = new Set(["/login", "/api/health"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const cookieName = SESSION_COOKIE_NAMES.find((name) => request.cookies.has(name));
  const token = cookieName ? request.cookies.get(cookieName)?.value : undefined;

  if (!cookieName || !token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "يجب تسجيل الدخول أولًا" } },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Keep the browser cookie alive as long as the user is active; the database
  // session remains the source of truth for validity and expiry.
  const response = NextResponse.next();
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: cookieName.startsWith("__Host-"),
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  });
  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals, PWA/static files and icons.
    "/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest|icons/|brand/|robots\\.txt).*)",
  ],
};
