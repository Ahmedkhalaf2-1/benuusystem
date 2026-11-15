import type { DbClient } from "@/lib/db/prisma";
import {
  countFailuresByEmailSince,
  countFailuresByIpSince,
  deleteAttemptsBefore,
  findOldestFailureSince,
  recordFailedLoginAttempt,
} from "@/server/repositories/login-attempt-repository";

/**
 * Failed-login limits within a sliding window:
 *  - per email: slows down guessing one account's password;
 *  - per IP: slows down trying many accounts from one device.
 */
export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  maxFailuresPerEmail: 5,
  maxFailuresPerIp: 20,
  /** Attempts older than this are deleted. */
  retentionMs: 24 * 60 * 60 * 1000,
} as const;

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export async function checkLoginRateLimit(
  db: DbClient,
  params: { email: string; ipAddress: string; now: Date },
): Promise<RateLimitDecision> {
  const since = new Date(params.now.getTime() - LOGIN_RATE_LIMIT.windowMs);

  const [emailFailures, ipFailures] = await Promise.all([
    countFailuresByEmailSince(db, params.email, since),
    countFailuresByIpSince(db, params.ipAddress, since),
  ]);

  const blockedBy =
    emailFailures >= LOGIN_RATE_LIMIT.maxFailuresPerEmail
      ? { email: params.email }
      : ipFailures >= LOGIN_RATE_LIMIT.maxFailuresPerIp
        ? { ipAddress: params.ipAddress }
        : null;

  if (!blockedBy) return { allowed: true };

  // Blocked until the oldest failure in the window falls out of it.
  const oldest = await findOldestFailureSince(db, blockedBy, since);
  const unblockAt =
    (oldest?.createdAt.getTime() ?? params.now.getTime()) + LOGIN_RATE_LIMIT.windowMs;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((unblockAt - params.now.getTime()) / 1000),
  );
  return { allowed: false, retryAfterSeconds };
}

export async function recordLoginFailure(
  db: DbClient,
  params: { email: string; ipAddress: string; now: Date },
): Promise<void> {
  await recordFailedLoginAttempt(db, {
    email: params.email,
    ipAddress: params.ipAddress,
    // Same clock as the window check, so the limit is consistent.
    createdAt: params.now,
  });
}

export async function pruneOldLoginAttempts(db: DbClient, now: Date): Promise<void> {
  await deleteAttemptsBefore(db, new Date(now.getTime() - LOGIN_RATE_LIMIT.retentionMs));
}
