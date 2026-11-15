-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('MATERIALS', 'PRINTING', 'EMBROIDERY', 'OUTSOURCED_LABOR', 'TRANSPORT', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'ELECTRICITY', 'WATER', 'INTERNET', 'MAINTENANCE', 'TRANSPORT', 'CLEANING', 'SUPPLIES', 'ADMINISTRATIVE', 'OTHER');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30),
    "notes" VARCHAR(1000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_costs" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "description" VARCHAR(200),
    "amount" DECIMAL(12,2) NOT NULL,
    "cost_date" DATE NOT NULL,
    "supplier_id" UUID,
    "notes" VARCHAR(500),
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "order_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general_expenses" (
    "id" UUID NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" VARCHAR(300),
    "amount" DECIMAL(12,2) NOT NULL,
    "expense_date" DATE NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "general_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outgoing_payments" (
    "id" UUID NOT NULL,
    "order_cost_id" UUID,
    "expense_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "notes" VARCHAR(500),
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "outgoing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "suppliers_phone_idx" ON "suppliers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "order_costs_idempotency_key_key" ON "order_costs"("idempotency_key");

-- CreateIndex
CREATE INDEX "order_costs_order_id_idx" ON "order_costs"("order_id");

-- CreateIndex
CREATE INDEX "order_costs_supplier_id_idx" ON "order_costs"("supplier_id");

-- CreateIndex
CREATE INDEX "order_costs_cost_date_idx" ON "order_costs"("cost_date");

-- CreateIndex
CREATE UNIQUE INDEX "general_expenses_idempotency_key_key" ON "general_expenses"("idempotency_key");

-- CreateIndex
CREATE INDEX "general_expenses_expense_date_idx" ON "general_expenses"("expense_date");

-- CreateIndex
CREATE INDEX "general_expenses_category_expense_date_idx" ON "general_expenses"("category", "expense_date");

-- CreateIndex
CREATE UNIQUE INDEX "outgoing_payments_idempotency_key_key" ON "outgoing_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "outgoing_payments_order_cost_id_idx" ON "outgoing_payments"("order_cost_id");

-- CreateIndex
CREATE INDEX "outgoing_payments_expense_id_idx" ON "outgoing_payments"("expense_id");

-- CreateIndex
CREATE INDEX "outgoing_payments_paid_at_idx" ON "outgoing_payments"("paid_at");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general_expenses" ADD CONSTRAINT "general_expenses_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general_expenses" ADD CONSTRAINT "general_expenses_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_order_cost_id_fkey" FOREIGN KEY ("order_cost_id") REFERENCES "order_costs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "general_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───── Business-rule guards ─────
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "general_expenses" ADD CONSTRAINT "general_expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_amount_positive" CHECK ("amount" > 0);

-- A payment pays exactly one thing: an order cost XOR a general expense.
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_exactly_one_target"
  CHECK (("order_cost_id" IS NULL) <> ("expense_id" IS NULL));

ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_void_consistent"
  CHECK (("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL));
ALTER TABLE "general_expenses" ADD CONSTRAINT "general_expenses_void_consistent"
  CHECK (("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL));
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_void_consistent"
  CHECK (("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL));
