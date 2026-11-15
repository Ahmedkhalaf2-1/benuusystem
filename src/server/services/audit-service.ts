import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db/prisma";
import { insertAuditLog } from "@/server/repositories/audit-log-repository";

/**
 * Known audit actions. Add new ones here as modules are built
 * (e.g. "ORDER_DELETED", "PAYMENT_RECORDED").
 */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGIN_BLOCKED_INACTIVE: "LOGIN_BLOCKED_INACTIVE",
  LOGIN_RATE_LIMITED: "LOGIN_RATE_LIMITED",
  LOGOUT: "LOGOUT",
  USER_CREATED: "USER_CREATED",
  CUSTOMER_CREATED: "CUSTOMER_CREATED",
  CUSTOMER_UPDATED: "CUSTOMER_UPDATED",
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_UPDATED: "ORDER_UPDATED",
  ORDER_PRICE_CHANGED: "ORDER_PRICE_CHANGED",
  ORDER_STATUS_CHANGED: "ORDER_STATUS_CHANGED",
  PAYMENT_RECORDED: "PAYMENT_RECORDED",
  PAYMENT_VOIDED: "PAYMENT_VOIDED",
  SUPPLIER_CREATED: "SUPPLIER_CREATED",
  SUPPLIER_UPDATED: "SUPPLIER_UPDATED",
  ORDER_COST_RECORDED: "ORDER_COST_RECORDED",
  ORDER_COST_VOIDED: "ORDER_COST_VOIDED",
  EXPENSE_RECORDED: "EXPENSE_RECORDED",
  EXPENSE_VOIDED: "EXPENSE_VOIDED",
  OUTGOING_PAYMENT_RECORDED: "OUTGOING_PAYMENT_RECORDED",
  OUTGOING_PAYMENT_VOIDED: "OUTGOING_PAYMENT_VOIDED",
  WORKER_CREATED: "WORKER_CREATED",
  WORKER_UPDATED: "WORKER_UPDATED",
  WORKDAY_RECORDED: "WORKDAY_RECORDED",
  WORKDAY_VOIDED: "WORKDAY_VOIDED",
  WORK_LOG_RECORDED: "WORK_LOG_RECORDED",
  WORK_LOG_VOIDED: "WORK_LOG_VOIDED",
  WORKER_PAYMENT_RECORDED: "WORKER_PAYMENT_RECORDED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditEntry = {
  userId: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Records an audit entry. Pass the transaction client when the audited change
 * happens in a transaction, so the change and its audit entry commit together.
 */
export async function recordAudit(db: DbClient, entry: AuditEntry): Promise<void> {
  await insertAuditLog(db, entry);
}
