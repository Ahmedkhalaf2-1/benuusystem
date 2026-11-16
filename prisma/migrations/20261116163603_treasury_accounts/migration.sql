-- Treasury: real money held in accounts.
-- Additive only. Every existing payment keeps account_id = NULL ("not
-- attributed"); nothing is classified automatically and no opening balance is
-- invented. Historical totals and reports are unchanged.

-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('CASH', 'BANK', 'WALLET');

-- CreateEnum
CREATE TYPE "TreasuryMovementKind" AS ENUM ('CAPITAL_IN', 'DRAWING', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MoneyDirection" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "order_payments" ADD COLUMN     "account_id" UUID;

-- AlterTable
ALTER TABLE "outgoing_payments" ADD COLUMN     "account_id" UUID;

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "opening_balance" DECIMAL(14,2) NOT NULL,
    "opening_date" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(300),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_movements" (
    "id" UUID NOT NULL,
    "kind" "TreasuryMovementKind" NOT NULL,
    "account_id" UUID NOT NULL,
    "to_account_id" UUID,
    "direction" "MoneyDirection",
    "amount" DECIMAL(14,2) NOT NULL,
    "movement_date" DATE NOT NULL,
    "notes" VARCHAR(500),
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "treasury_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_reconciliations" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "count_date" DATE NOT NULL,
    "counted_amount" DECIMAL(14,2) NOT NULL,
    "system_balance" DECIMAL(14,2) NOT NULL,
    "notes" VARCHAR(500),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_name_key" ON "financial_accounts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_movements_idempotency_key_key" ON "treasury_movements"("idempotency_key");

-- CreateIndex
CREATE INDEX "treasury_movements_account_id_movement_date_idx" ON "treasury_movements"("account_id", "movement_date");

-- CreateIndex
CREATE INDEX "treasury_movements_to_account_id_movement_date_idx" ON "treasury_movements"("to_account_id", "movement_date");

-- CreateIndex
CREATE INDEX "treasury_reconciliations_account_id_count_date_idx" ON "treasury_reconciliations"("account_id", "count_date");

-- CreateIndex
CREATE INDEX "order_payments_account_id_paid_at_idx" ON "order_payments"("account_id", "paid_at");

-- CreateIndex
CREATE INDEX "outgoing_payments_account_id_paid_at_idx" ON "outgoing_payments"("account_id", "paid_at");

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliations" ADD CONSTRAINT "treasury_reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliations" ADD CONSTRAINT "treasury_reconciliations_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity the application also enforces.
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_currency_egp" CHECK ("currency" = 'EGP');
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_shape" CHECK (
  ("kind" = 'TRANSFER' AND "to_account_id" IS NOT NULL AND "to_account_id" <> "account_id" AND "direction" IS NULL)
  OR ("kind" = 'ADJUSTMENT' AND "to_account_id" IS NULL AND "direction" IS NOT NULL)
  OR ("kind" IN ('CAPITAL_IN', 'DRAWING') AND "to_account_id" IS NULL AND "direction" IS NULL)
);
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_void_consistent" CHECK (
  ("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
  OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL)
);
