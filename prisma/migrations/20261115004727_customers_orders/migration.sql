-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuantityUnit" AS ENUM ('PIECE', 'SET', 'DOZEN', 'METER');

-- CreateEnum
CREATE TYPE "PrintOperation" AS ENUM ('DTF', 'SCREEN_PRINT', 'EMBROIDERY');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'INSTAPAY', 'OTHER');

-- CreateTable
CREATE TABLE "counters" (
    "key" VARCHAR(64) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30),
    "notes" VARCHAR(1000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customer_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "product_type" VARCHAR(80) NOT NULL,
    "material" VARCHAR(80) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" "QuantityUnit" NOT NULL DEFAULT 'PIECE',
    "total_price" DECIMAL(12,2) NOT NULL,
    "received_date" DATE NOT NULL,
    "delivery_date" DATE NOT NULL,
    "notes" VARCHAR(2000),
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "idempotency_key" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_groups" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "material" VARCHAR(80) NOT NULL,
    "notes" VARCHAR(500),

    CONSTRAINT "order_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_group_operations" (
    "group_id" UUID NOT NULL,
    "operation" "PrintOperation" NOT NULL,

    CONSTRAINT "order_group_operations_pkey" PRIMARY KEY ("group_id","operation")
);

-- CreateTable
CREATE TABLE "order_payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "notes" VARCHAR(500),
    "is_advance" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_created_at_idx" ON "customers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_status_delivery_date_idx" ON "orders"("status", "delivery_date");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "orders_delivery_date_idx" ON "orders"("delivery_date");

-- CreateIndex
CREATE UNIQUE INDEX "order_groups_order_id_position_key" ON "order_groups"("order_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "order_payments_idempotency_key_key" ON "order_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "order_payments_order_id_idx" ON "order_payments"("order_id");

-- CreateIndex
CREATE INDEX "order_payments_paid_at_idx" ON "order_payments"("paid_at");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_group_operations" ADD CONSTRAINT "order_group_operations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "order_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───── Business-rule guards (second line of defence behind Zod validation) ─────
ALTER TABLE "customers" ADD CONSTRAINT "customers_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_positive" CHECK ("number" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_price_non_negative" CHECK ("total_price" >= 0);
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_position_positive" CHECK ("position" > 0);
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_void_consistent"
  CHECK (("voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "void_reason" IS NOT NULL));

-- Order number counter starts at 0 → first order is #1.
INSERT INTO "counters" ("key", "value") VALUES ('order_number', 0) ON CONFLICT DO NOTHING;
