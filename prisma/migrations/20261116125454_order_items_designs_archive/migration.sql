-- CreateEnum
CREATE TYPE "OrderPricing" AS ENUM ('ORDER_TOTAL', 'PER_ITEM');

-- AlterTable
ALTER TABLE "order_groups" ADD COLUMN     "name" VARCHAR(120),
ADD COLUMN     "presses_per_unit" INTEGER,
ADD COLUMN     "unit_price" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "archive_reason" VARCHAR(300),
ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "archived_by_id" UUID,
ADD COLUMN     "pricing" "OrderPricing" NOT NULL DEFAULT 'ORDER_TOTAL';

-- AlterTable
ALTER TABLE "production_stage_progress" ADD COLUMN     "design_id" UUID;

-- CreateTable
CREATE TABLE "order_group_designs" (
    "id" UUID NOT NULL,
    "order_group_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(120),
    "operation" "PrintOperation" NOT NULL,
    "placements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_placements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quantity" INTEGER NOT NULL,
    "presses_per_unit" INTEGER,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_group_designs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_group_designs_order_group_id_position_key" ON "order_group_designs"("order_group_id", "position");

-- CreateIndex
CREATE INDEX "orders_archived_at_idx" ON "orders"("archived_at");

-- CreateIndex
CREATE INDEX "production_stage_progress_design_id_idx" ON "production_stage_progress"("design_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_progress" ADD CONSTRAINT "production_stage_progress_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "order_group_designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_group_designs" ADD CONSTRAINT "order_group_designs_order_group_id_fkey" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards. Existing rows satisfy them: every new column is NULL / default, and
-- order_group_designs starts empty (older items are never given designs).
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_unit_price_check" CHECK ("unit_price" IS NULL OR "unit_price" >= 0);
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_presses_per_unit_check" CHECK ("presses_per_unit" IS NULL OR "presses_per_unit" BETWEEN 0 AND 100);
ALTER TABLE "order_group_designs" ADD CONSTRAINT "order_group_designs_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "order_group_designs" ADD CONSTRAINT "order_group_designs_position_check" CHECK ("position" > 0);
ALTER TABLE "order_group_designs" ADD CONSTRAINT "order_group_designs_presses_check" CHECK ("presses_per_unit" IS NULL OR "presses_per_unit" BETWEEN 0 AND 100);
ALTER TABLE "order_group_designs" ADD CONSTRAINT "order_group_designs_placements_check"
  CHECK ("placements" <@ ARRAY['CHEST', 'BACK', 'BADGE', 'RIGHT_SLEEVE', 'LEFT_SLEEVE']::text[]);
ALTER TABLE "order_group_designs" ADD CONSTRAINT "order_group_designs_custom_placements_check" CHECK (cardinality("custom_placements") <= 5);
-- An archived order always says who archived it and why.
ALTER TABLE "orders" ADD CONSTRAINT "orders_archive_check" CHECK (
  ("archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NULL)
  OR ("archived_at" IS NOT NULL AND "archived_by_id" IS NOT NULL AND "archive_reason" IS NOT NULL)
);
