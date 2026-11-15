import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id with the OWASP-recommended baseline parameters
 * (19 MiB memory, 2 iterations, 1 lane). The parameters are stored inside each
 * hash string, so they can be raised later without breaking existing hashes.
 */
const ARGON2_OPTIONS = {
  // Algorithm.Argon2id — the enum is an ambient const enum, which cannot be
  // referenced under `isolatedModules`, so the numeric value is used directly.
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed hash: treat as a failed verification, never as success.
    return false;
  }
}

/**
 * A real Argon2id hash of a random value, used to spend the same time on
 * logins for unknown emails as for known ones (prevents user enumeration by timing).
 */
let dummyHashPromise: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(crypto.randomUUID());
  return dummyHashPromise;
}
