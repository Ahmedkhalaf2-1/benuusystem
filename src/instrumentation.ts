/** Runs once when the server starts (see src/instrumentation-node.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { checkProductionConfig } = await import("./instrumentation-node");
  checkProductionConfig();
}
