/**
 * Client IP for rate limiting and audit logs.
 *
 * In production the app listens on 127.0.0.1 behind Caddy. Caddy (by default)
 * does not trust an incoming X-Forwarded-For and replaces it with the real
 * client address, so the right-most entry is the trustworthy one.
 */
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const entries = forwardedFor.split(",").map((entry) => entry.trim()).filter(Boolean);
    const last = entries.at(-1);
    if (last) return last.slice(0, 64);
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  return "unknown";
}
