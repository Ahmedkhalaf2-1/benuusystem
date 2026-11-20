-- Phase 3: department finance, partner settlements, ready-made presets.
--
-- Additive only: new nullable columns / columns with defaults, two new tables,
-- CHECK constraints on the NEW columns only, and a seed of the preset list.
-- No existing row's value is changed. No enum is altered, so this migration
-- does not require ownership of any PostgreSQL type (unlike Phase 2's
-- change to the Role enum — see section 18 of the architecture plan).
--
--   * department_members: two new switches, both OFF (nobody gains access).
--   * orders.hidden_from_departments: OFF (same behaviour as before).
--   * users.supplier_id: partner ↔ supplier link (settlements); empty.
--   * order_costs: optional department and «بالقطعة» (pieces × cost per piece).
--   * order_group_value_shares: owner's explicit split of a shared item's value.
--   * product_presets: the «منتج جاهز» list, seeded with the six built-in names.

-- AlterTable
ALTER TABLE "department_members" ADD COLUMN     "can_view_collections" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_view_settlements" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "order_costs" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "quantity" INTEGER,
ADD COLUMN     "unit_cost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "hidden_from_departments" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "supplier_id" UUID;

-- CreateTable
CREATE TABLE "order_group_value_shares" (
    "order_group_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "set_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_group_value_shares_pkey" PRIMARY KEY ("order_group_id","department_id")
);

-- CreateTable
CREATE TABLE "product_presets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_group_value_shares_department_id_idx" ON "order_group_value_shares"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_presets_name_key" ON "product_presets"("name");

-- CreateIndex
CREATE INDEX "order_costs_department_id_idx" ON "order_costs"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_supplier_id_key" ON "users"("supplier_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_group_value_shares" ADD CONSTRAINT "order_group_value_shares_order_group_id_fkey" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_group_value_shares" ADD CONSTRAINT "order_group_value_shares_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_group_value_shares" ADD CONSTRAINT "order_group_value_shares_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_presets" ADD CONSTRAINT "product_presets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity of the new money columns.
ALTER TABLE "order_group_value_shares" ADD CONSTRAINT "order_group_value_shares_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_per_piece_pair" CHECK (("quantity" IS NULL) = ("unit_cost" IS NULL));
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_per_piece_positive" CHECK ("quantity" IS NULL OR ("quantity" > 0 AND "unit_cost" > 0));

-- The «منتج جاهز» presets (previously a fixed list in code).
INSERT INTO "product_presets" ("id", "name", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'تيشيرت', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'هودي', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'سويت شيرت', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'بولو', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'كاب', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'شنطة', 6, CURRENT_TIMESTAMP);
