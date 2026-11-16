/**
 * Fictional LOCAL preview data for design review.
 *
 *   DATABASE_URL=postgresql://…@localhost:5432/benuuprint_preview npx tsx scripts/seed-preview.ts
 *
 * Refuses to run unless DATABASE_URL points at localhost / 127.0.0.1 and a
 * database whose name ends in `_preview`, and the database is empty. Every
 * record goes through the real services, so all totals are derived exactly as
 * in production. Names and amounts are invented; nothing comes from real data.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { dateFromString, dateToString, todayDateString } from "@/lib/dates";
import type { Actor } from "@/server/services/actor";
import { createCustomer } from "@/server/services/customer-service";
import { recordOrderCost } from "@/server/services/cost-service";
import { recordExpense } from "@/server/services/expense-service";
import { createOrder, getOrderDetails } from "@/server/services/order-service";
import { recordPayment } from "@/server/services/payment-service";
import { recordDelivery, recordReady, recordStageProgress } from "@/server/services/production-service";
import { createSupplier } from "@/server/services/supplier-service";
import { createAccount, recordMovement } from "@/server/services/treasury-service";
import { recordWorkday, recordWorkLog } from "@/server/services/work-service";
import { payWorker } from "@/server/services/worker-payment-service";
import { createWorker } from "@/server/services/worker-service";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const dbName = url.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !dbName.endsWith("_preview")) {
  console.error(`Refusing: seed-preview only writes to a LOCAL *_preview database (got ${url.hostname}/${dbName}).`);
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
const TODAY = todayDateString();
const day = (offset: number) => dateToString(new Date(dateFromString(TODAY).getTime() + offset * 86_400_000));
const key = () => randomUUID();

export const PREVIEW_ACCOUNTS = {
  owner: { email: "owner@preview.local", password: "preview-owner-1" },
  desk: { email: "desk@preview.local", password: "preview-desk-1" },
  floor: { email: "floor@preview.local", password: "preview-floor-1" },
};

async function main() {
  if ((await db.user.count()) > 0) {
    console.error("Refusing: the preview database is not empty. Recreate it first.");
    process.exit(1);
  }
  const owner: Actor = await db.user.create({
    data: { name: "أحمد خلف", email: PREVIEW_ACCOUNTS.owner.email, passwordHash: await hashPassword(PREVIEW_ACCOUNTS.owner.password), role: "OWNER_ADMIN" },
    select: { id: true, role: true, permissions: true },
  });
  await db.user.create({
    data: {
      name: "منى — الاستقبال",
      email: PREVIEW_ACCOUNTS.desk.email,
      passwordHash: await hashPassword(PREVIEW_ACCOUNTS.desk.password),
      role: "STAFF",
      permissions: ["orders:view", "orders:view-prices", "orders:create", "orders:edit", "production:view", "deliveries:view", "deliveries:record", "customers:view", "customers:view-contact", "customers:manage", "payments:view", "payments:record", "expenses:record"],
    },
  });
  await db.user.create({
    data: { name: "كريم — الإنتاج", email: PREVIEW_ACCOUNTS.floor.email, passwordHash: await hashPassword(PREVIEW_ACCOUNTS.floor.password), role: "STAFF", permissions: ["orders:view", "production:view", "production:record", "deliveries:view"] },
  });

  // Treasury first (opening counted at the start of the day a week ago), so new money is attributed.
  const cash = (await createAccount(db, owner, { name: "خزنة المحل", type: "CASH", openingBalance: "18500", countDate: day(-7), basis: "START_OF_DAY", confirmed: true })).id;
  const bank = (await createAccount(db, owner, { name: "بنك مصر — جاري", type: "BANK", openingBalance: "64000", countDate: day(-7), basis: "START_OF_DAY", confirmed: true })).id;
  const wallet = (await createAccount(db, owner, { name: "فودافون كاش", type: "WALLET", openingBalance: "3200", countDate: day(-7), basis: "START_OF_DAY", confirmed: true })).id;

  const names = ["شركة النيل للمقاولات", "مدرسة الفجر الدولية", "كافيه ركن الصباح", "أكاديمية رواد", "نادي الشمس الرياضي", "محل أبو يوسف للملابس"];
  const customers: string[] = [];
  for (const [i, name] of names.entries()) customers.push((await createCustomer(db, owner, { name, phone: `0101000${String(1000 + i * 37).padStart(4, "0")}` })).id);

  type Spec = {
    c: number;
    title: string;
    product: string;
    received: number;
    due: number;
    items: { name: string; qty: number; price: string; ops: string[]; designs?: { name: string; op: string; placements: string[] }[]; sizes?: [string, number][] }[];
    advance?: string;
    advanceAccount?: string;
  };
  const specs: Spec[] = [
    {
      c: 1, title: "زي المدرسة — الترم التاني", product: "تيشيرت", received: -6, due: 2, advance: "15000", advanceAccount: bank,
      items: [
        { name: "تيشيرت أبيض بشعار المدرسة", qty: 300, price: "95", ops: [], designs: [{ name: "شعار الصدر", op: "DTF", placements: ["CHEST"] }, { name: "اسم المدرسة ضهر", op: "DTF", placements: ["BACK"] }], sizes: [["S", 60], ["M", 120], ["L", 90], ["XL", 30]] },
        { name: "تيشيرت كحلي للمدرسين", qty: 40, price: "120", ops: ["EMBROIDERY"], sizes: [["M", 15], ["L", 15], ["XL", 10]] },
      ],
    },
    {
      c: 0, title: "يونيفورم موقع العاصمة", product: "بولو", received: -5, due: -1, advance: "8000", advanceAccount: cash,
      items: [{ name: "بولو رمادي مطرز", qty: 120, price: "185", ops: ["EMBROIDERY"], sizes: [["L", 50], ["XL", 50], ["2XL", 20]] }],
    },
    { c: 2, title: "مجات وتيشيرتات الافتتاح", product: "تيشيرت", received: -3, due: 0, advance: "2500", advanceAccount: wallet, items: [{ name: "تيشيرت أسود DTF", qty: 60, price: "140", ops: ["DTF"] }] },
    { c: 3, title: "هوديز الدفعة الجديدة", product: "هودي", received: -2, due: 9, items: [{ name: "هودي بيج سلك سكرين", qty: 80, price: "260", ops: ["SCREEN_PRINT"], sizes: [["M", 30], ["L", 30], ["XL", 20]] }] },
    { c: 4, title: "تيشيرتات البطولة", product: "تيشيرت", received: -1, due: 5, advance: "5000", advanceAccount: cash, items: [{ name: "تيشيرت رياضي بالرقم", qty: 150, price: "110", ops: ["DTF"] }] },
    { c: 5, title: "طلبية جرابات موبايل", product: "جراب موبايل", received: 0, due: 3, items: [{ name: "جراب مطبوع", qty: 200, price: "45", ops: ["DTF"] }] },
  ];

  const orders: { id: string; groups: { id: string; sizes: { id: string; quantity: number }[]; designs: { id: string }[] }[] }[] = [];
  for (const s of specs) {
    const totalQty = s.items.reduce((n, i) => n + i.qty, 0);
    const { orderId } = await createOrder(
      db,
      owner,
      {
        idempotencyKey: key(),
        customer: { mode: "existing", id: customers[s.c]! },
        title: s.title,
        productType: s.product,
        material: "قطن",
        quantity: String(totalQty),
        unit: "PIECE",
        pricing: "items",
        sizesEnabled: s.items.some((i) => i.sizes),
        groups: s.items.map((i) => ({
          name: i.name,
          quantity: String(i.qty),
          unitPrice: i.price,
          operations: i.ops,
          plain: false,
          ...(i.designs ? { designs: i.designs.map((d) => ({ name: d.name, operation: d.op, placements: d.placements })) } : {}),
          ...(i.sizes ? { sizes: i.sizes.map(([label, quantity]) => ({ label, quantity: String(quantity) })) } : {}),
        })),
        advance: s.advance ?? "0",
        advanceMethod: s.advanceAccount === bank ? "BANK_TRANSFER" : s.advanceAccount === wallet ? "INSTAPAY" : "CASH",
        ...(s.advanceAccount ? { advanceAccountId: s.advanceAccount } : {}),
        receivedDate: day(s.received),
        deliveryDate: day(s.due),
      } as never,
      { visibility: "ALL_AUTHORIZED_STAFF" },
    );
    const d = (await getOrderDetails(db, owner, orderId))!;
    orders.push({ id: orderId, groups: d.groups.map((g) => ({ id: g.id, sizes: g.sizes, designs: g.designs })) });
  }

  // Production and partial deliveries (sized items per size).
  const lines = (g: { sizes: { id: string; quantity: number }[] }, share: number) =>
    g.sizes.length ? { sizes: g.sizes.map((s) => ({ sizeId: s.id, quantity: String(Math.floor(s.quantity * share)) })).filter((l) => l.quantity !== "0") } : null;
  const school = orders[0]!;
  for (const dsg of school.groups[0]!.designs) {
    await recordStageProgress(db, owner, { orderId: school.id, orderGroupId: school.groups[0]!.id, designId: dsg.id, operation: "DTF", ...lines(school.groups[0]!, 0.6), workDate: day(-2), idempotencyKey: key() } as never);
  }
  await recordReady(db, owner, { orderId: school.id, orderGroupId: school.groups[0]!.id, ...lines(school.groups[0]!, 0.5), readyDate: day(-1), idempotencyKey: key(), confirmAllOperations: true } as never);
  await recordDelivery(db, owner, { orderId: school.id, orderGroupId: school.groups[0]!.id, ...lines(school.groups[0]!, 0.25), deliveredAt: day(0), idempotencyKey: key() } as never);

  const site = orders[1]!;
  await recordStageProgress(db, owner, { orderId: site.id, orderGroupId: site.groups[0]!.id, operation: "EMBROIDERY", ...lines(site.groups[0]!, 0.8), workDate: day(-1), idempotencyKey: key(), alsoReady: true } as never);

  const cafe = orders[2]!;
  await recordStageProgress(db, owner, { orderId: cafe.id, orderGroupId: cafe.groups[0]!.id, operation: "DTF", quantity: "60", workDate: day(-1), idempotencyKey: key(), alsoReady: true });
  await recordDelivery(db, owner, { orderId: cafe.id, orderGroupId: cafe.groups[0]!.id, quantity: "60", deliveredAt: day(0), idempotencyKey: key() });
  await recordPayment(db, owner, { orderId: cafe.id, idempotencyKey: key(), amount: "5900", paidAt: day(0), method: "CASH", accountId: cash });

  await recordPayment(db, owner, { orderId: site.id, idempotencyKey: key(), amount: "6000", paidAt: day(-1), method: "BANK_TRANSFER", accountId: bank });

  // Suppliers and costs.
  const fabric = await createSupplier(db, owner, { name: "مصنع القطن المصري", phone: "01223334455" });
  await recordOrderCost(db, owner, { orderId: school.id, idempotencyKey: key(), category: "MATERIALS", description: "تيشيرتات خام بيضاء 300 قطعة", amount: "13500", costDate: day(-5), payStatus: "PARTIAL", paidNow: "7000", method: "CASH", accountId: cash, supplier: { mode: "existing", id: fabric.id } } as never);
  await recordOrderCost(db, owner, { orderId: site.id, idempotencyKey: key(), category: "MATERIALS", description: "بولو رمادي 120 قطعة", amount: "9600", costDate: day(-4), payStatus: "CREDIT", supplier: { mode: "existing", id: fabric.id } } as never);

  // General expenses: one paid, one recorded unpaid.
  await recordExpense(db, owner, { idempotencyKey: key(), category: "RENT", description: "إيجار الورشة", amount: "7000", expenseDate: day(-6), payStatus: "FULL", method: "BANK_TRANSFER", accountId: bank });
  await recordExpense(db, owner, { idempotencyKey: key(), category: "ELECTRICITY", description: "فاتورة الكهربا", amount: "1450", expenseDate: day(-2), payStatus: "CREDIT" });

  // Workers, attendance, output, pay.
  const youssef = await createWorker(db, owner, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "350", dailyTarget: "300", targetUnit: "PRINT" });
  const samir = await createWorker(db, owner, { name: "سمير", job: "EMBROIDERY", dailyWage: "400" });
  for (const offset of [-3, -2, -1]) {
    await recordWorkday(db, owner, { workerId: youssef.id, idempotencyKey: key(), workDate: day(offset), worked: true });
    await recordWorkday(db, owner, { workerId: samir.id, idempotencyKey: key(), workDate: day(offset), worked: true });
  }
  await recordWorkLog(db, owner, { workerId: youssef.id, idempotencyKey: key(), workDate: day(-2), orderId: school.id, orderGroupId: school.groups[0]!.id, workType: "DTF", quantity: "320", unit: "PRINT" } as never);
  await payWorker(db, owner, { workerId: youssef.id, idempotencyKey: key(), type: "WAGE", amount: "700", paidAt: day(-1), method: "CASH", accountId: cash });
  await payWorker(db, owner, { workerId: samir.id, idempotencyKey: key(), type: "ADVANCE", amount: "300", paidAt: day(0), method: "INSTAPAY", accountId: wallet });

  // Owner moves: deposit some cash at the bank.
  await recordMovement(db, owner, { kind: "TRANSFER", accountId: cash, toAccountId: bank, amount: "5000", date: day(-1), notes: "إيداع في البنك", idempotencyKey: key() });

  console.log("Preview data ready.");
  console.log(JSON.stringify(PREVIEW_ACCOUNTS, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
