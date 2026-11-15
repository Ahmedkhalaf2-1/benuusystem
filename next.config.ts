import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Restrictions that need no nonces: no framing, no <base> or plugin
  // injection, forms only post back to this site. (script-src is left to
  // defaults: Next.js and the theme script use inline scripts.)
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Only honoured by browsers over HTTPS (i.e. behind Caddy in production).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Every screen in this app is authenticated and per-user, so pages are
  // rendered on each request. Cache Components (static shells + "use cache")
  // is left off on purpose: it adds Suspense/caching rules around every
  // session read with little benefit for an always-online internal tool.
  cacheComponents: false,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
