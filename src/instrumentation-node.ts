import { getEnv, productionConfigProblems } from "@/lib/env";

/**
 * Production startup check (Node.js runtime only; loaded by instrumentation.ts).
 * Refuses to start with a broken or unsafe configuration: the process exits
 * with code 1 at boot, so the supervisor (systemd) records a failed start and
 * its log says why, instead of the app running and failing every request.
 * Values are never printed — only the variable name and the problem.
 */
export function checkProductionConfig(): void {
  const problems = productionConfigProblems(process.env);
  if (problems.length > 0) {
    console.error(`[startup] Refusing to start: invalid production configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    // Next.js only logs an error thrown from register() and keeps serving 500s.
    process.exit(1);
  }
  if (!getEnv().SESSION_COOKIE_SECURE) {
    console.warn(
      "[startup] SESSION_COOKIE_SECURE=false: session cookies will be sent over plain http. " +
        "Only acceptable for a local production test — never on the VPS.",
    );
  }
  console.info("[startup] configuration ok");
}
