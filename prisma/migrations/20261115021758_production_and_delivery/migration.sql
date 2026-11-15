-- AlterEnum
ALTER TYPE "PrintOperation" ADD VALUE 'MANUFACTURING';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "completed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "production_stage_progress" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_group_id" UUID NOT NULL,
    "operation" "PrintOperation" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "work_date" DATE NOT NULL,
    "notes" VARCHAR(500),
    "work_log_id" UUID,
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "production_stage_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_ready" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_group_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ready_date" DATE NOT NULL,
    "notes" VARCHAR(500),
    "stage_progress_id" UUID,
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "production_ready_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_group_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "delivered_at" DATE NOT NULL,
    "notes" VARCHAR(500),
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_stage_progress_work_log_id_key" ON "production_stage_progress"("work_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_stage_progress_idempotency_key_key" ON "production_stage_progress"("idempotency_key");

-- CreateIndex
CREATE INDEX "production_stage_progress_order_id_idx" ON "production_stage_progress"("order_id");

-- CreateIndex
CREATE INDEX "production_stage_progress_order_group_id_operation_idx" ON "production_stage_progress"("order_group_id", "operation");

-- CreateIndex
CREATE INDEX "production_stage_progress_work_date_idx" ON "production_stage_progress"("work_date");

-- CreateIndex
CREATE UNIQUE INDEX "production_ready_stage_progress_id_key" ON "production_ready"("stage_progress_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_ready_idempotency_key_key" ON "production_ready"("idempotency_key");

-- CreateIndex
CREATE INDEX "production_ready_order_id_idx" ON "production_ready"("order_id");

-- CreateIndex
CREATE INDEX "production_ready_order_group_id_idx" ON "production_ready"("order_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_idempotency_key_key" ON "deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "deliveries_order_id_idx" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_order_group_id_idx" ON "deliveries"("order_group_id");

-- CreateIndex
CREATE INDEX "deliveries_delivered_at_idx" ON "deliveries"("delivered_at");

-- AddForeignKey
ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_order_group_id_fkey" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_order_group_id_operation_fkey" FOREIGN KEY ("order_group_id", "operation") REFERENCES "order_group_operations"("group_id", "operation") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_work_log_id_fkey" FOREIGN KEY ("work_log_id") REFERENCES "worker_work_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_ready" ADD CONSTRAINT "production_ready_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_ready" ADD CONSTRAINT "production_ready_order_group_id_fkey" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_ready" ADD CONSTRAINT "production_ready_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_ready" ADD CONSTRAINT "production_ready_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_group_id_fkey" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───── Business-rule guards ─────
ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "production_ready" ADD CONSTRAINT "production_ready_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_void_consistent"
  CHECK (("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL));
ALTER TABLE "production_ready" ADD CONSTRAINT "production_ready_void_consistent"
  CHECK (("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL));
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_void_consistent"
  CHECK (("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL));

-- "Completed" and its timestamp always go together (no existing order is COMPLETED).
ALTER TABLE "orders" ADD CONSTRAINT "orders_completed_at_consistent"
  CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL));
