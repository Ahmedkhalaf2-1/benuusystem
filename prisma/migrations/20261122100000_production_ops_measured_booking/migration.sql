-- Work-kind production operations, measured (decimal) raw-material quantities,
-- and an explicit booking state for every order cost.
--
-- Additive:
--   * PrintOperation gains VINYL, SUBLIMATION, OTHER_PRINT (printing for
--     others is tracked through production like any other step). Requires the
--     role that OWNS the enum (checked by `npm run db:check`).
--   * ItemPricingBasis gains MEASURED; order_groups gains measured_quantity.
--   * order_costs.posted_at (added by the previous, same-release migration)
--     is filled for costs that were ALREADY payables (is_draft = false) with
--     their creation time, so "booked" is explicit for every row. No amount,
--     supplier or payment changes; nothing is booked twice.
-- New enum values are not used inside this migration.

-- AlterEnum
ALTER TYPE "ItemPricingBasis" ADD VALUE 'MEASURED';

-- AlterEnum
ALTER TYPE "PrintOperation" ADD VALUE 'VINYL';
ALTER TYPE "PrintOperation" ADD VALUE 'SUBLIMATION';
ALTER TYPE "PrintOperation" ADD VALUE 'OTHER_PRINT';

-- AlterTable
ALTER TABLE "order_groups" ADD COLUMN     "measured_quantity" DECIMAL(14,3);
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_measured_quantity_positive" CHECK ("measured_quantity" IS NULL OR "measured_quantity" > 0);

-- Explicit booking state: every booked (non-draft) cost has its booking time.
UPDATE "order_costs" SET "posted_at" = "created_at" WHERE "is_draft" = false AND "posted_at" IS NULL;
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_booked_has_posted_at" CHECK ("is_draft" OR "posted_at" IS NOT NULL);
