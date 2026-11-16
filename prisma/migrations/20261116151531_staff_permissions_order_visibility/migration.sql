-- Phase 10: per-user staff permissions and per-order staff visibility.
--
-- Additive only: no existing column, total, payment, production, delivery or
-- item/design row is changed or removed.
--
-- Access changes on deploy (documented in docs/staff-permissions.md):
--   * Every existing order becomes PRIVATE (owner only). The owner shares
--     orders with staff afterwards. Nothing is visible to staff by accident.
--   * Existing STAFF accounts keep exactly the capabilities the old STAFF role
--     gave them — written out below as explicit permissions (including the
--     reads that role implied: order prices, payment history, production and
--     delivery progress, customer phone numbers). No account gains anything.
--     The owner reviews and narrows them in «إدارة المستخدمين والصلاحيات».
--   * Owner accounts are unchanged (owners always have every permission).
--   * Staff accounts created from now on start with no permissions.

-- CreateEnum
CREATE TYPE "OrderVisibility" AS ENUM ('PRIVATE', 'ALL_AUTHORIZED_STAFF', 'SELECTED_STAFF');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "access_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visibility" "OrderVisibility" NOT NULL DEFAULT 'PRIVATE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "permissions_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "order_access" (
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_access_pkey" PRIMARY KEY ("order_id","user_id")
);

-- CreateIndex
CREATE INDEX "order_access_user_id_idx" ON "order_access"("user_id");

-- AddForeignKey
ALTER TABLE "order_access" ADD CONSTRAINT "order_access_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_access" ADD CONSTRAINT "order_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_access" ADD CONSTRAINT "order_access_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the legacy STAFF role's capabilities on existing staff accounts.
UPDATE "users"
SET "permissions" = ARRAY[
  'orders:view', 'orders:view-prices', 'orders:create', 'orders:edit',
  'production:view', 'production:record', 'deliveries:view', 'deliveries:record',
  'customers:view', 'customers:view-contact', 'customers:manage',
  'payments:view', 'payments:record',
  'costs:record', 'expenses:record', 'payables:pay',
  'suppliers:view', 'suppliers:manage',
  'workers:view', 'work:record'
]::TEXT[]
WHERE "role" = 'STAFF';
