-- Phase 2: departments, partner accounts and department membership.
--
-- Additive only: no existing column, total, payment, treasury, production or
-- delivery row is changed or removed. The only UPDATE fills the NEW
-- order_groups.department_id column (documented below).
--
-- Access changes on deploy (documented in
-- docs/DEPARTMENT_DASHBOARDS_AND_ORDER_FLEXIBILITY_PLAN.md, section 17):
--   * A new account role PARTNER. No existing account changes role.
--   * No account gains any access: department membership starts empty.
--   * Four departments are created. The owner can change their names, deactivate them or add more.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PARTNER';

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40),
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_members" (
    "department_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "can_view_work" BOOLEAN NOT NULL DEFAULT true,
    "can_view_money" BOOLEAN NOT NULL DEFAULT false,
    "can_record_production" BOOLEAN NOT NULL DEFAULT false,
    "granted_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "department_members_pkey" PRIMARY KEY ("department_id","user_id")
);

-- AlterTable
ALTER TABLE "order_groups" ADD COLUMN     "department_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "departments_key_key" ON "departments"("key");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE INDEX "department_members_user_id_idx" ON "department_members"("user_id");

-- CreateIndex
CREATE INDEX "order_groups_department_id_idx" ON "order_groups"("department_id");

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the four departments (the owner manages them afterwards).
INSERT INTO "departments" ("id", "key", "name", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'EMBROIDERY', 'تطريز', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'COVERS', 'كوفرات', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PRINTING', 'طباعة', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GARMENTS', 'ملابس / منتج كامل', 4, CURRENT_TIMESTAMP);

-- Give every EXISTING item one department, with the same rule the app uses to
-- suggest one (src/lib/departments/suggest.ts):
--   1. item name (or, if unnamed, the order's product type) mentions covers → COVERS
--   2. otherwise by the item's primary work type: its first design's operation,
--      or (older items) its first item-level operation in the order
--      MANUFACTURING, DTF, SCREEN_PRINT, EMBROIDERY:
--      EMBROIDERY → EMBROIDERY; DTF / SCREEN_PRINT → PRINTING;
--      MANUFACTURING or no work type (ready-made) → GARMENTS
-- Values, quantities and prices are untouched; the owner can change any item.
WITH primary_op AS (
  SELECT g.id,
         COALESCE(
           (SELECT d.operation::text FROM "order_group_designs" d WHERE d.order_group_id = g.id ORDER BY d.position LIMIT 1),
           (SELECT o.operation::text FROM "order_group_operations" o WHERE o.group_id = g.id
              ORDER BY CASE o.operation::text WHEN 'MANUFACTURING' THEN 0 WHEN 'DTF' THEN 1 WHEN 'SCREEN_PRINT' THEN 2 ELSE 3 END LIMIT 1)
         ) AS op,
         COALESCE(NULLIF(g.name, ''), ord.product_type) AS label
  FROM "order_groups" g
  JOIN "orders" ord ON ord.id = g.order_id
)
UPDATE "order_groups" g
SET "department_id" = dep.id
FROM primary_op p, "departments" dep
WHERE p.id = g.id
  AND dep.key = CASE
    WHEN p.label ~* '(جراب|كوفر|cover)' THEN 'COVERS'
    WHEN p.op = 'EMBROIDERY' THEN 'EMBROIDERY'
    WHEN p.op IN ('DTF', 'SCREEN_PRINT') THEN 'PRINTING'
    ELSE 'GARMENTS'
  END;
