-- Order work kinds, linear-meter pricing, cost review and material consumption.
--
-- Additive only: new enums (created, not altered), nullable columns or
-- columns with defaults, two new tables, CHECK constraints on NEW columns
-- only, and indexes. No existing row's value is changed:
--   * order_groups: existing items keep pricing_basis UNIT and no work kind.
--   * orders.cost_status stays NULL on existing orders ("before cost
--     tracking"); the app sets PENDING on new orders.
--   * order_costs.is_draft defaults to false: every existing cost stays a
--     posted payable exactly as before.

-- CreateEnum
CREATE TYPE "ItemPricingBasis" AS ENUM ('UNIT', 'LINEAR_METER');

-- CreateEnum
CREATE TYPE "CostReviewStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'CLOSED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "order_costs" ADD COLUMN     "is_draft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "material_name" VARCHAR(120),
ADD COLUMN     "material_variant" VARCHAR(80),
ADD COLUMN     "order_group_id" UUID,
ADD COLUMN     "posted_at" TIMESTAMPTZ(3),
ADD COLUMN     "usage_quantity" DECIMAL(14,3),
ADD COLUMN     "usage_unit" VARCHAR(20),
ADD COLUMN     "usage_unit_cost" DECIMAL(12,2),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_groups" ADD COLUMN     "billable_length_mm" INTEGER,
ADD COLUMN     "copies_per_row" INTEGER,
ADD COLUMN     "file_length_mm" INTEGER,
ADD COLUMN     "file_width_mm" INTEGER,
ADD COLUMN     "pricing_basis" "ItemPricingBasis" NOT NULL DEFAULT 'UNIT',
ADD COLUMN     "roll_width_mm" INTEGER,
ADD COLUMN     "sale_unit" VARCHAR(20),
ADD COLUMN     "thread_color" VARCHAR(60),
ADD COLUMN     "variant" VARCHAR(40),
ADD COLUMN     "variant_text" VARCHAR(120),
ADD COLUMN     "work_kind" VARCHAR(40);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cost_reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "cost_reviewed_by_id" UUID,
ADD COLUMN     "cost_status" "CostReviewStatus",
ADD COLUMN     "cost_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "order_cost_revisions" (
    "id" UUID NOT NULL,
    "order_cost_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_cost_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_kind_settings" (
    "work_kind" VARCHAR(40) NOT NULL,
    "roll_width_mm" INTEGER,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_kind_settings_pkey" PRIMARY KEY ("work_kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_cost_revisions_order_cost_id_version_key" ON "order_cost_revisions"("order_cost_id", "version");

-- CreateIndex
CREATE INDEX "order_costs_order_group_id_idx" ON "order_costs"("order_group_id");

-- CreateIndex
CREATE INDEX "order_costs_material_name_cost_date_idx" ON "order_costs"("material_name", "cost_date");

-- AddForeignKey
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_order_group_id_fkey" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cost_revisions" ADD CONSTRAINT "order_cost_revisions_order_cost_id_fkey" FOREIGN KEY ("order_cost_id") REFERENCES "order_costs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cost_revisions" ADD CONSTRAINT "order_cost_revisions_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_kind_settings" ADD CONSTRAINT "work_kind_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Linear-meter items carry their whole measurement; dimensions are positive.
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_linear_meter_complete" CHECK (
  "pricing_basis" <> 'LINEAR_METER' OR (
    "file_width_mm" > 0 AND "file_length_mm" > 0 AND "copies_per_row" > 0 AND "roll_width_mm" > 0 AND "billable_length_mm" > 0
    AND "file_width_mm" * "copies_per_row" <= "roll_width_mm"
  )
);
-- Material usage: quantity and unit together, positive; a draft is never posted.
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_usage_pair" CHECK (("usage_quantity" IS NULL) = ("usage_unit" IS NULL));
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_usage_positive" CHECK ("usage_quantity" IS NULL OR "usage_quantity" > 0);
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_usage_unit_cost_positive" CHECK ("usage_unit_cost" IS NULL OR "usage_unit_cost" >= 0);
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_draft_not_posted" CHECK (NOT ("is_draft" AND "posted_at" IS NOT NULL));
ALTER TABLE "work_kind_settings" ADD CONSTRAINT "work_kind_settings_roll_width_positive" CHECK ("roll_width_mm" IS NULL OR "roll_width_mm" > 0);
