import { createHash, randomBytes } from "node:crypto";

/** Session cookie name. `__Host-` prefix needs Secure, so it is only used over HTTPS. */
export function getSessionCookieName(secure: boolean): string {
  return secure ? "__Host-benuuprint_session" : "benuuprint_session";
}

/** Both possible cookie names, for code that must find the cookie without env (the proxy). */
export const SESSION_COOKIE_NAMES = [
  "__Host-benuuprint_session",
  "benuuprint_session",
] as const;

/** Sessions last 30 days and are extended when used during their second half. */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_REFRESH_THRESHOLD_MS = SESSION_DURATION_MS / 2;

/** 256 bits of randomness, base64url-encoded (43 chars). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored in the database. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Rejects obviously malformed cookie values before touching the database. */
export function isWellFormedSessionToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
