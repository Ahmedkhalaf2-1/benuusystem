-- CreateEnum
CREATE TYPE "WorkerJob" AS ENUM ('DTF_PRINTING', 'EMBROIDERY', 'SCREEN_PRINTING', 'GARMENT_MAKING', 'FINISHING_PACKING', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkUnit" AS ENUM ('PIECE', 'PRINT', 'METER', 'PRESS', 'COVER');

-- CreateEnum
CREATE TYPE "WorkType" AS ENUM ('DTF', 'SCREEN_PRINT', 'EMBROIDERY', 'CUTTING', 'SEWING', 'FINISHING', 'PACKING', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkerPaymentType" AS ENUM ('WAGE', 'ADVANCE');

-- AlterTable
ALTER TABLE "outgoing_payments" ADD COLUMN     "worker_id" UUID,
ADD COLUMN     "worker_payment_type" "WorkerPaymentType";

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30),
    "job" "WorkerJob" NOT NULL,
    "job_title" VARCHAR(80),
    "daily_wage" DECIMAL(12,2) NOT NULL,
    "daily_target" INTEGER,
    "target_unit" "WorkUnit",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(1000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_workdays" (
    "id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "worked" BOOLEAN NOT NULL DEFAULT true,
    "wage" DECIMAL(12,2) NOT NULL,
    "notes" VARCHAR(500),
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "worker_workdays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_work_logs" (
    "id" UUID NOT NULL,
    "workday_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "order_id" UUID,
    "order_group_id" UUID,
    "work_type" "WorkType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" "WorkUnit" NOT NULL,
    "hours" DECIMAL(5,2),
    "notes" VARCHAR(500),
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "worker_work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workers_is_active_name_idx" ON "workers"("is_active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "worker_workdays_idempotency_key_key" ON "worker_workdays"("idempotency_key");

-- CreateIndex
CREATE INDEX "worker_workdays_worker_id_work_date_idx" ON "worker_workdays"("worker_id", "work_date");

-- CreateIndex
CREATE INDEX "worker_workdays_work_date_idx" ON "worker_workdays"("work_date");

-- CreateIndex
CREATE UNIQUE INDEX "worker_work_logs_idempotency_key_key" ON "worker_work_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX "worker_work_logs_workday_id_idx" ON "worker_work_logs"("workday_id");

-- CreateIndex
CREATE INDEX "worker_work_logs_order_id_idx" ON "worker_work_logs"("order_id");

-- CreateIndex
CREATE INDEX "worker_work_logs_order_group_id_idx" ON "worker_work_logs"("order_group_id");

-- CreateIndex
CREATE INDEX "worker_work_logs_worker_id_created_at_idx" ON "worker_work_logs"("worker_id", "created_at");

-- CreateIndex
CREATE INDEX "outgoing_payments_worker_id_paid_at_idx" ON "outgoing_payments"("worker_id", "paid_at");

-- AddForeignKey
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_workdays" ADD CONSTRAINT "worker_workdays_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_workdays" ADD CONSTRAINT "worker_workdays_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_workdays" ADD CONSTRAINT "worker_workdays_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_workday_id_fkey" FOREIGN KEY ("workday_id") REFERENCES "worker_workdays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_order_group_id_fkey" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───── Business-rule guards ─────

-- A payment out pays exactly ONE thing: an order cost, a general expense, or a worker.
-- (Replaces the Phase 3 two-way rule; every existing row already satisfies the new one.)
ALTER TABLE "outgoing_payments" DROP CONSTRAINT "outgoing_payments_exactly_one_target";
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_exactly_one_target"
  CHECK (num_nonnulls("order_cost_id", "expense_id", "worker_id") = 1);
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_worker_type_consistent"
  CHECK (("worker_id" IS NULL) = ("worker_payment_type" IS NULL));

ALTER TABLE "workers" ADD CONSTRAINT "workers_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "workers" ADD CONSTRAINT "workers_daily_wage_non_negative" CHECK ("daily_wage" >= 0);
ALTER TABLE "workers" ADD CONSTRAINT "workers_target_consistent"
  CHECK (("daily_target" IS NULL AND "target_unit" IS NULL) OR ("daily_target" > 0 AND "target_unit" IS NOT NULL));

ALTER TABLE "worker_workdays" ADD CONSTRAINT "worker_workdays_wage_non_negative" CHECK ("wage" >= 0);
-- An absence earns nothing.
ALTER TABLE "worker_workdays" ADD CONSTRAINT "worker_workdays_absent_no_wage" CHECK ("worked" OR "wage" = 0);
ALTER TABLE "worker_workdays" ADD CONSTRAINT "worker_workdays_void_consistent"
  CHECK (("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL));
-- One valid day per worker and date: the daily wage can never be counted twice.
CREATE UNIQUE INDEX "worker_workdays_one_valid_per_day"
  ON "worker_workdays" ("worker_id", "work_date") WHERE "voided_at" IS NULL;

ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_hours_positive" CHECK ("hours" IS NULL OR "hours" > 0);
ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_group_needs_order"
  CHECK ("order_group_id" IS NULL OR "order_id" IS NOT NULL);
ALTER TABLE "worker_work_logs" ADD CONSTRAINT "worker_work_logs_void_consistent"
  CHECK (("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL));
