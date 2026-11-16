import "server-only";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { formatDateAr } from "@/lib/dates";
import type { DocOrder, Period } from "@/lib/documents/customer-account";
import { orderBalance } from "@/lib/documents/customer-account";
import { DELIVERY_STATUS_LABELS, type DeliveryEntry } from "@/lib/documents/delivery-history";
import { formatAmount, formatMoney, type Cents } from "@/lib/money";
import { describeOperations, OPERATION_LABELS, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, UNIT_LABELS } from "@/lib/orders/labels";
import type { getCustomerOrdersSummary, getCustomerStatement, InvoiceData } from "@/server/services/customer-documents-service";
import { ltr } from "./pdf/arabic-text";
import { C, PdfDoc } from "./pdf/document";

/**
 * The three customer documents. Every figure comes from
 * src/lib/documents/customer-account.ts, so the PDFs agree with each other
 * and with the customer/order screens. Wording is plain Egyptian Arabic, as
 * in the app. These are commercial documents, not tax invoices.
 */

const NOT_TAX = "مستند تجاري من سجلات Benuuprint — ليس فاتورة ضريبية.";

function periodLabel(p: Period): string {
  if (p.from && p.to) return `من ${formatDateAr(p.from)} لحد ${formatDateAr(p.to)}`;
  if (p.from) return `من ${formatDateAr(p.from)} لحد النهارده`;
  if (p.to) return `لحد ${formatDateAr(p.to)}`;
  return "كل الأوردرات";
}

const num = (n: number) => ltr(`#${String(n).padStart(4, "0")}`);
const amount = (c: Cents) => formatAmount(c);
const method = (m: string) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;

/** Balance in words a customer understands: owed, or credit in their favour. */
function balanceText(c: Cents): string {
  if (c > 0n) return `${amount(c)} عليه`;
  if (c < 0n) return `${amount(-c)} له`;
  return "0";
}

// ───────────────────────────── 1. Order invoice ─────────────────────────────

export async function renderOrderInvoice(data: InvoiceData): Promise<Buffer> {
  const { order, customer, balance: b } = data;
  const pdf = new PdfDoc({ title: `فاتورة أوردر ${num(order.number)}`, runningTitle: `فاتورة أوردر ${num(order.number)} — ${customer.name}`, generatedAt: data.generatedAt });
  pdf.header("فاتورة أوردر", NOT_TAX, `أوردر ${num(order.number)}`);

  if (b.cancelled) pdf.callout("الأوردر ده ملغي — المبلغ المتفق عليه مش مستحق على العميل.", "danger");

  pdf.sectionTitle("بيانات العميل والأوردر");
  pdf.keyValues([
    ["العميل", customer.name],
    ["التليفون", customer.phone ?? "—"],
    ["رقم الأوردر", num(order.number)],
    ["تاريخ الإصدار", formatDateAr(data.generatedAt)],
    ["الأوردر", order.title],
    ["نوع المنتج", order.productType],
    ["تاريخ الاستلام", formatDateAr(order.receivedDate)],
    ["ميعاد التسليم", formatDateAr(order.deliveryDate)],
    ["الكمية", `${new Intl.NumberFormat("en-US").format(order.quantity)} ${UNIT_LABELS[order.unit]}`],
    ["الحالة", ORDER_STATUS_LABELS[order.status]],
  ]);

  renderItems(pdf, data);

  renderDeliveries(pdf, data);

  pdf.sectionTitle("المدفوعات والحساب");
  if (order.payments.length === 0) pdf.paragraph("مفيش مدفوعات متسجلة على الأوردر ده.");
  else
    pdf.table(
      [
        { header: "التاريخ", width: 26, value: (p) => formatDateAr(p.paidAt) },
        { header: "النوع", width: 20, value: (p) => (p.isAdvance ? "مقدم" : "دفعة") },
        { header: "طريقة الدفع", width: 26, value: (p) => method(p.method) },
        { header: "المبلغ (ج.م)", width: 28, align: "left", font: "semibold", value: (p) => amount(p.amount) },
      ],
      order.payments,
    );

  const lines: { label: string; value: string; strong?: boolean; color?: string }[] = [
    { label: b.cancelled ? "السعر المتفق عليه (ملغي)" : "إجمالي الأوردر المتفق عليه", value: formatMoney(order.totalPrice), color: b.cancelled ? C.muted : undefined },
    { label: "إجمالي المدفوع", value: formatMoney(b.paid), color: C.success },
  ];
  if (b.cancelled) {
    lines.push({ label: "المتبقي", value: "غير مستحق", strong: true });
  } else {
    lines.push({ label: "المتبقي على العميل", value: formatMoney(b.outstanding), strong: true });
    if (b.overpaid > 0n) lines.push({ label: "مدفوع زيادة (رصيد للعميل)", value: formatMoney(b.overpaid), color: C.warning });
  }
  pdf.totals(lines);

  if (b.paidOnCancelled > 0n)
    pdf.callout(`اتدفع ${formatMoney(b.paidOnCancelled)} على الأوردر ده قبل إلغائه. لسه محتاج قرار: يترد للعميل أو يتحسب رصيد ليه. (مفيش رد فلوس متسجل في البرنامج.)`, "warning");
  pdf.paragraph(
    (data.pricing === "PER_ITEM" ? "إجمالي الأوردر = مجموع إجماليات البنود." : "السعر هو إجمالي الأوردر المتفق عليه؛ مفيش سعر منفصل لكل قطعة.") +
      (data.voidedPayments > 0 ? ` الدفعات الملغية (${data.voidedPayments}) مش ظاهرة ومش محسوبة.` : ""),
  );
  return pdf.finish();
}

/**
 * The order's items. Per-item pricing: name, quantity, unit price, line total,
 * the work (each design with its operation and placement) and sizes — the
 * line totals add up to the order total. Older orders priced as one total keep
 * that single agreed price; no per-item prices are made up for them.
 * Planned presses are internal and never printed here.
 */
function renderItems(pdf: PdfDoc, data: InvoiceData) {
  const unit = UNIT_LABELS[data.order.unit];
  const qty = (n: number) => `${new Intl.NumberFormat("en-US").format(n)} ${unit}`;
  const work = (g: InvoiceData["groups"][number]) =>
    g.designs.length > 0
      ? g.designs
          .map((d) => [d.label, OPERATION_LABELS[d.operation], d.placements, d.quantity < g.quantity ? `${new Intl.NumberFormat("en-US").format(d.quantity)} قطعة` : ""].filter(Boolean).join(" — "))
          .join("\n")
      : describeOperations(g.operations);
  const sizes = (g: InvoiceData["groups"][number]) => (g.sizes.length ? g.sizes.map((s) => `${s.label}: ${s.quantity}`).join("  ·  ") : "—");
  const anySizes = data.groups.some((g) => g.sizes.length > 0);

  if (data.pricing === "PER_ITEM") {
    pdf.sectionTitle(`البنود (${data.groups.length})`);
    pdf.table(
      [
        // Sizes sit under the item (they describe its pieces), leaving room for the designs.
        { header: "البند", width: 24, font: "semibold", value: (g) => [g.label, g.material, g.sizes.length ? sizes(g) : ""].filter(Boolean).join("\n") },
        { header: "الكمية", width: 11, value: (g) => qty(g.quantity) },
        { header: "سعر الوحدة", width: 10, align: "left", value: (g) => (g.unitPrice === null ? "—" : amount(g.unitPrice)) },
        { header: "الإجمالي (ج.م)", width: 12, align: "left", font: "semibold", value: (g) => (g.lineTotal === null ? "—" : amount(g.lineTotal)) },
        { header: "الشغل والرسومات", width: 43, value: work },
      ],
      data.groups,
    );
  } else {
    pdf.sectionTitle("تفاصيل الشغل");
    pdf.table(
      [
        { header: "البند", width: 20, value: (g) => g.label },
        { header: "الكمية", width: 11, value: (g) => qty(g.quantity) },
        { header: "الخامة", width: 18, value: (g) => g.material },
        { header: "الشغل", width: anySizes ? 25 : 51, value: work },
        ...(anySizes ? [{ header: "المقاسات", width: 26, value: sizes }] : []),
      ],
      data.groups,
    );
    pdf.paragraph("الأوردر ده متسعّر بسعر إجمالي واحد متفق عليه، من غير سعر منفصل لكل بند.");
  }
}

/**
 * «سجل التسليمات»: physical pieces handed over, from valid Delivery records
 * only. Kept apart from the money figures — neither is inferred from the other.
 */
function renderDeliveries(pdf: PdfDoc, data: InvoiceData) {
  const h = data.deliveries;
  const unit = UNIT_LABELS[data.order.unit];
  const qty = (n: number) => `${new Intl.NumberFormat("en-US").format(n)} ${unit}`;
  const remainingText = (n: number) => (n < 0 ? `زيادة ${qty(-n)}` : qty(n));

  pdf.sectionTitle("سجل التسليمات");
  if (h.entries.length === 0) {
    pdf.paragraph("لا توجد تسليمات مسجلة.", 10, C.ink);
  } else {
    const multiGroup = data.groups.length > 1;
    const anyNotes = h.entries.some((e) => e.notes);
    const anySizes = h.entries.some((e) => e.sizes.length > 0);
    const cols: Parameters<typeof pdf.table<DeliveryEntry>>[0] = [
      { header: "#", width: 6, value: (e) => String(e.seq) },
      { header: "التاريخ", width: 16, value: (e) => formatDateAr(e.date) },
      ...(multiGroup ? [{ header: "البند", width: 13, value: (e: DeliveryEntry) => e.groupLabel }] : []),
      { header: "الكمية", width: 11, font: "semibold" as const, value: (e) => qty(e.quantity) },
      ...(anySizes
        ? [{ header: "المقاسات", width: anyNotes ? 20 : 30, value: (e: DeliveryEntry) => (e.sizes.length ? e.sizes.map((x) => `${x.label}: ${x.quantity}`).join("  ·  ") : "—") }]
        : []),
      ...(anyNotes ? [{ header: "ملاحظات", width: 14, value: (e: DeliveryEntry) => e.notes ?? "" }] : []),
      { header: "إجمالي المسلَّم", width: 12, value: (e) => qty(e.cumulative) },
      { header: "المتبقي للتسليم", width: 12, font: "semibold" as const, value: (e) => remainingText(e.remaining) },
    ];
    pdf.table(cols, h.entries);
  }

  pdf.totals([
    { label: "إجمالي كمية الأوردر", value: qty(h.total) },
    { label: "إجمالي ما تم تسليمه", value: qty(h.delivered), color: C.success },
    { label: "المتبقي للتسليم", value: remainingText(h.remaining), strong: true },
    { label: "حالة التسليم", value: DELIVERY_STATUS_LABELS[h.status] },
    ...(h.lastDate ? [{ label: "تاريخ آخر تسليم", value: formatDateAr(h.lastDate) }] : []),
  ]);

  // Say it plainly when the order status and the delivery records disagree.
  const status = data.order.status;
  if (status === "COMPLETED" && h.status !== "complete")
    pdf.callout(`حالة الأوردر «مكتمل»، لكن التسليمات المسجلة ${qty(h.delivered)} من ${qty(h.total)}. الأرقام فوق من سجلات التسليم الفعلية.`, "warning");
  if (h.status === "complete" && (status === "NEW" || status === "IN_PROGRESS"))
    pdf.callout("كل الكمية متسلمة حسب سجلات التسليم، لكن حالة الأوردر لسه مش «مكتمل».", "warning");
  if (status === "CANCELLED" && h.delivered > 0) pdf.callout(`الأوردر ملغي، واتسجل تسليم ${qty(h.delivered)} قبل الإلغاء.`, "info");
  if (h.overDeliveredGroups.length > 0)
    pdf.callout(`المسلَّم في ${h.overDeliveredGroups.join("، ")} أكتر من الكمية — محتاج مراجعة.`, "warning");
  if (data.voidedDeliveries > 0) pdf.paragraph(`التسليمات الملغية (${data.voidedDeliveries}) مش محسوبة.`);
}

// ───────────────────────────── 2. Customer orders summary ─────────────────────────────

type Summary = NonNullable<Awaited<ReturnType<typeof getCustomerOrdersSummary>>>;

export async function renderOrdersSummary(data: Summary): Promise<Buffer> {
  const { customer, totals: t } = data;
  const pdf = new PdfDoc({ title: `ملخص أوردرات ${customer.name}`, runningTitle: `ملخص أوردرات — ${customer.name}`, generatedAt: data.generatedAt });
  pdf.header("ملخص أوردرات العميل", NOT_TAX, customer.name);

  pdf.keyValues([
    ["العميل", customer.name],
    ["التليفون", customer.phone ?? "—"],
    ["الفترة (بتاريخ الأوردر)", periodLabel(data.period)],
    ["تاريخ الإصدار", formatDateAr(data.generatedAt)],
  ]);

  const active = data.orders.filter((o) => o.status !== "CANCELLED");
  const cancelled = data.orders.filter((o) => o.status === "CANCELLED");
  const cols = (forCancelled: boolean) => [
    { header: "رقم", width: 10, value: (o: DocOrder) => num(o.number) },
    { header: "التاريخ", width: 17, value: (o: DocOrder) => formatDateAr(o.receivedDate) },
    { header: "الأوردر", width: 25, value: (o: DocOrder) => `${o.title} — ${o.productType}` },
    { header: "الحالة", width: 11, value: (o: DocOrder) => ORDER_STATUS_LABELS[o.status] },
    { header: forCancelled ? "السعر (غير مستحق)" : "الإجمالي", width: 13, align: "left" as const, value: (o: DocOrder) => amount(o.totalPrice) },
    { header: "المدفوع", width: 12, align: "left" as const, value: (o: DocOrder) => amount(orderBalance(o).paid) },
    {
      header: forCancelled ? "محتاج قرار" : "المتبقي",
      width: 12,
      align: "left" as const,
      font: "semibold" as const,
      value: (o: DocOrder) => {
        const b = orderBalance(o);
        if (b.cancelled) return b.paidOnCancelled > 0n ? amount(b.paidOnCancelled) : "—";
        return b.overpaid > 0n ? `${amount(b.overpaid)} له` : amount(b.outstanding);
      },
    },
  ];

  pdf.sectionTitle(`الأوردرات (${active.length})`);
  if (active.length === 0) pdf.paragraph(data.orders.length === 0 ? "مفيش أوردرات للعميل ده في الفترة دي." : "مفيش أوردرات سارية في الفترة دي.");
  else pdf.table(cols(false), active);

  if (cancelled.length > 0) {
    pdf.sectionTitle(`أوردرات ملغية (${cancelled.length}) — مش داخلة في الإجماليات`);
    pdf.table(cols(true), cancelled, { tone: () => ({ color: C.muted }) });
  }

  const lines: { label: string; value: string; strong?: boolean; color?: string }[] = [
    { label: "عدد الأوردرات", value: cancelled.length ? `${t.activeCount} (+ ${t.cancelledCount} ملغي)` : String(t.activeCount) },
    { label: "إجمالي قيمة الأوردرات", value: formatMoney(t.agreed) },
    { label: "إجمالي المدفوع", value: formatMoney(t.paid), color: C.success },
    { label: "المتبقي على العميل", value: formatMoney(t.net), strong: true },
  ];
  pdf.totals(lines);
  if (t.overpaid > 0n)
    pdf.callout(
      `فيه ${formatMoney(t.overpaid)} مدفوعة زيادة عن سعر بعض الأوردرات، ومخصومة من المتبقي فوق. المتبقي على الأوردرات اللي لسه عليها فلوس بس: ${formatMoney(t.outstanding)}.`,
      "info",
    );
  if (t.paidOnCancelled > 0n)
    pdf.callout(`اتدفع ${formatMoney(t.paidOnCancelled)} على أوردرات اتلغت. المبلغ ده مش مخصوم من المتبقي ولسه محتاج قرار: يترد للعميل أو يتحسب رصيد ليه.`, "warning");
  pdf.paragraph("الإجماليات بالأسعار المتفق عليها حاليًا وبالدفعات السليمة بس (الدفعات الملغية مش محسوبة).");
  return pdf.finish();
}

// ───────────────────────────── 3. Customer account statement ─────────────────────────────

type StatementData = NonNullable<Awaited<ReturnType<typeof getCustomerStatement>>>;

export async function renderStatement(data: StatementData): Promise<Buffer> {
  const { customer, statement: s } = data;
  const pdf = new PdfDoc({ title: `كشف حساب ${customer.name}`, runningTitle: `كشف حساب — ${customer.name}`, generatedAt: data.generatedAt });
  pdf.header("كشف حساب عميل", NOT_TAX, customer.name);

  pdf.keyValues([
    ["العميل", customer.name],
    ["التليفون", customer.phone ?? "—"],
    ["الفترة", periodLabel(s.period)],
    ["تاريخ الإصدار", formatDateAr(data.generatedAt)],
  ]);
  pdf.callout(
    "كشف مبني على البيانات الحالية: كل أوردر ساري بسعره المتفق عليه دلوقتي في تاريخ الأوردر، وكل دفعة سليمة في تاريخ دفعها. مش صورة تاريخية لحساب العميل في الماضي (تعديلات السعر وتواريخ الإلغاء مش محفوظة كحركات).",
    "info",
  );

  type Row = { date: string; text: string; order: string; debit: string; credit: string; balance: string; muted?: boolean };
  const rows: Row[] = [];
  if (s.period.from) rows.push({ date: formatDateAr(s.period.from), text: "رصيد أول المدة", order: "", debit: "", credit: "", balance: balanceText(s.opening), muted: true });
  for (const e of s.entries) {
    rows.push({
      date: formatDateAr(e.date),
      text:
        e.kind === "charge"
          ? `أوردر: ${e.orderTitle}`
          : `${e.isAdvance ? "مقدم" : "دفعة"} — ${method(e.method ?? "")}${e.onCancelledOrder ? " (على أوردر ملغي)" : ""}`,
      order: num(e.orderNumber),
      debit: e.debit ? amount(e.debit) : "",
      credit: e.credit ? amount(e.credit) : "",
      balance: balanceText(e.balance),
    });
  }

  pdf.sectionTitle("الحركات");
  if (s.entries.length === 0) pdf.paragraph("مفيش حركات في الفترة دي.");
  pdf.table(
    [
      { header: "التاريخ", width: 18, value: (r: Row) => r.date },
      { header: "البيان", width: 28, value: (r: Row) => r.text },
      { header: "رقم الأوردر", width: 11, value: (r: Row) => r.order },
      { header: "مطلوب (ج.م)", width: 14, align: "left", value: (r: Row) => r.debit },
      { header: "مدفوع (ج.م)", width: 14, align: "left", value: (r: Row) => r.credit },
      { header: "الرصيد", width: 15, align: "left", font: "semibold", value: (r: Row) => r.balance },
    ],
    rows,
    { tone: (r) => (r.muted ? { fill: C.well, color: C.muted } : undefined) },
  );

  pdf.totals([
    ...(s.period.from ? [{ label: "رصيد أول المدة", value: balanceText(s.opening) }] : []),
    { label: "إجمالي المطلوب (أوردرات)", value: formatMoney(s.totalDebit) },
    { label: "إجمالي المدفوع", value: formatMoney(s.totalCredit), color: C.success },
    { label: s.closing < 0n ? "الرصيد في آخر المدة (رصيد للعميل)" : "الرصيد في آخر المدة (على العميل)", value: formatMoney(s.closing < 0n ? -s.closing : s.closing), strong: true },
  ]);

  if (s.paidOnCancelledToDate > 0n) {
    const list = data.cancelledOrders.filter((o) => o.paid > 0n).map((o) => `${num(o.number)} (${formatMoney(o.paid)})`).join("، ");
    pdf.callout(
      `الرصيد فوق فيه ${formatMoney(s.paidOnCancelledToDate)} اتدفعت على أوردرات اتلغت: ${list}. المبلغ ده لسه محتاج قرار — يترد للعميل أو يفضل رصيد ليه. البرنامج مفيهوش حركة رد فلوس، فمفيش رد متسجل.`,
      "warning",
    );
  }
  const cancelledNoPay = data.cancelledOrders.filter((o) => o.paid === 0n).length;
  pdf.paragraph(
    "مطلوب = سعر الأوردر المتفق عليه. مدفوع = الدفعات السليمة بس (الملغية مش محسوبة). الرصيد الموجب على العميل، و«له» يعني رصيد لصالح العميل." +
      (cancelledNoPay ? ` فيه ${cancelledNoPay} أوردر ملغي من غير مدفوعات، ومش ظاهر في الحركات.` : ""),
  );
  return pdf.finish();
}
