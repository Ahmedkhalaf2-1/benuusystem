-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "order_group_size_id" UUID;

-- AlterTable
ALTER TABLE "production_ready" ADD COLUMN     "order_group_size_id" UUID;

-- AlterTable
ALTER TABLE "production_stage_progress" ADD COLUMN     "order_group_size_id" UUID;

-- CreateTable
CREATE TABLE "order_group_sizes" (
    "id" UUID NOT NULL,
    "order_group_id" UUID NOT NULL,
    "label" VARCHAR(24) NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_group_sizes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_group_sizes_order_group_id_position_idx" ON "order_group_sizes"("order_group_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "order_group_sizes_order_group_id_label_key" ON "order_group_sizes"("order_group_id", "label");

-- CreateIndex
CREATE INDEX "deliveries_order_group_size_id_idx" ON "deliveries"("order_group_size_id");

-- CreateIndex
CREATE INDEX "production_ready_order_group_size_id_idx" ON "production_ready"("order_group_size_id");

-- CreateIndex
CREATE INDEX "production_stage_progress_order_group_size_id_idx" ON "production_stage_progress"("order_group_size_id");

-- AddForeignKey
ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_order_group_size_id_fkey" FOREIGN KEY ("order_group_size_id") REFERENCES "order_group_sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_ready" ADD CONSTRAINT "production_ready_order_group_size_id_fkey" FOREIGN KEY ("order_group_size_id") REFERENCES "order_group_sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_group_size_id_fkey" FOREIGN KEY ("order_group_size_id") REFERENCES "order_group_sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_group_sizes" ADD CONSTRAINT "order_group_sizes_order_group_id_fkey" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Business-rule guards ─────
ALTER TABLE "order_group_sizes" ADD CONSTRAINT "order_group_sizes_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_group_sizes" ADD CONSTRAINT "order_group_sizes_position_positive" CHECK ("position" > 0);
ALTER TABLE "order_group_sizes" ADD CONSTRAINT "order_group_sizes_label_not_blank" CHECK (length(btrim("label")) > 0);
