import { z } from "zod";

/**
 * Server environment variables, validated on first use.
 * Validation is lazy so `next build` does not require a database URL;
 * the first request (or CLI command) fails fast with a clear message instead.
 */
const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgresql:// URL"),
  SESSION_COOKIE_SECURE: booleanString.optional(),
});

export type ServerEnv = Omit<z.infer<typeof envSchema>, "SESSION_COOKIE_SECURE"> & {
  SESSION_COOKIE_SECURE: boolean;
};

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;
  cached = {
    ...env,
    SESSION_COOKIE_SECURE:
      env.SESSION_COOKIE_SECURE ?? env.NODE_ENV === "production",
  };
  return cached;
}

/** The local Docker password from docker-compose.yml / .env.example. */
const DEV_DATABASE_PASSWORD = "change-me-local-dev";

/**
 * Configuration mistakes that must stop a PRODUCTION server from starting
 * (checked once at startup by src/instrumentation.ts). Pure, for testing.
 */
export function productionConfigProblems(source: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`${issue.path.join(".") || "env"}: ${issue.message}`);
    return problems;
  }
  let url: URL | undefined;
  try {
    url = new URL(parsed.data.DATABASE_URL);
  } catch {
    problems.push("DATABASE_URL: not a valid URL");
  }
  if (url && decodeURIComponent(url.password) === DEV_DATABASE_PASSWORD) {
    problems.push("DATABASE_URL: uses the local development password; generate a new one for production");
  }
  if (url && /^(benuuprint_test|.*_test)$/.test(url.pathname.replace(/^\//, ""))) {
    problems.push("DATABASE_URL: points at a test database (wiped by the test suite)");
  }
  return problems;
}
