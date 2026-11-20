-- Order profitability & monthly financial closing.
--
-- Additive only: no UPDATE, DELETE or backfill of existing rows.
--   * ExpenseCategory gains SALARIES (staff who are not daily-wage workers).
--     Requires the role that OWNS the enum (checked by `npm run db:check`).
--   * general_expenses: is_fixed (default false — existing expenses stay
--     "operating"), and an optional link to a recurring template + month,
--     unique per template per month so a fixed expense is never generated twice.
--   * recurring_expenses: fixed monthly expense templates (no money moves).
--   * monthly_closes / monthly_close_events: the owner's monthly review —
--     a confirmed snapshot and its audit trail. Nothing is locked or posted.
-- The new enum value is not used inside this migration.

-- CreateEnum
CREATE TYPE "MonthlyCloseStatus" AS ENUM ('CONFIRMED', 'REOPENED');

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'SALARIES';

-- AlterTable
ALTER TABLE "general_expenses" ADD COLUMN     "is_fixed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurring_id" UUID,
ADD COLUMN     "recurring_month" CHAR(7);

-- CreateTable
CREATE TABLE "recurring_expenses" (
    "id" UUID NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "day_of_month" INTEGER NOT NULL,
    "start_month" CHAR(7) NOT NULL,
    "end_month" CHAR(7),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_closes" (
    "id" UUID NOT NULL,
    "month" CHAR(7) NOT NULL,
    "status" "MonthlyCloseStatus" NOT NULL,
    "basis" VARCHAR(20) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "notes" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "monthly_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_close_events" (
    "id" UUID NOT NULL,
    "close_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(500),
    "snapshot" JSONB NOT NULL,
    "by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_close_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_closes_month_key" ON "monthly_closes"("month");

-- CreateIndex
CREATE INDEX "monthly_close_events_close_id_created_at_idx" ON "monthly_close_events"("close_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "general_expenses_recurring_id_recurring_month_key" ON "general_expenses"("recurring_id", "recurring_month");

-- AddForeignKey
ALTER TABLE "general_expenses" ADD CONSTRAINT "general_expenses_recurring_id_fkey" FOREIGN KEY ("recurring_id") REFERENCES "recurring_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_closes" ADD CONSTRAINT "monthly_closes_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_close_events" ADD CONSTRAINT "monthly_close_events_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "monthly_closes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_close_events" ADD CONSTRAINT "monthly_close_events_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_day_range" CHECK ("day_of_month" BETWEEN 1 AND 28);
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_months" CHECK ("start_month" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND ("end_month" IS NULL OR ("end_month" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND "end_month" >= "start_month")));
ALTER TABLE "general_expenses" ADD CONSTRAINT "general_expenses_recurring_pair" CHECK (("recurring_id" IS NULL) = ("recurring_month" IS NULL));
ALTER TABLE "monthly_closes" ADD CONSTRAINT "monthly_closes_month_format" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "monthly_close_events" ADD CONSTRAINT "monthly_close_events_action" CHECK ("action" IN ('CONFIRMED', 'REOPENED'));
