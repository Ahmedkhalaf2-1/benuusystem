import { Eye, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

const primary =
  "flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink transition-[border-color,transform] hover:border-line-strong active:scale-[0.98]";
const secondary =
  "flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold text-brand-ink bg-brand-soft transition-transform active:scale-[0.98]";

/** Download (saves the PDF) and preview (opens the browser's PDF viewer to print or share). */
export function OrderInvoiceActions({ orderId, className }: { orderId: string; className?: string }) {
  const base = `/api/documents/orders/${orderId}/invoice`;
  return (
    <div className={cn("flex gap-2", className)}>
      <a href={`${base}?download=1`} className={primary} data-testid="invoice-download">
        <FileDown className="size-5 shrink-0" aria-hidden="true" />
        تحميل فاتورة PDF
      </a>
      <a href={base} target="_blank" rel="noopener" className={secondary} aria-label="معاينة الفاتورة">
        <Eye className="size-4" aria-hidden="true" />
        معاينة
      </a>
    </div>
  );
}

/** Orders summary and account statement, for all orders or a date range (by order date). */
export function CustomerDocumentsSection({ customerId }: { customerId: string }) {
  const base = `/api/documents/customers/${customerId}`;
  const docs = [
    { path: "orders", label: "تحميل ملخص الأوردرات PDF", preview: "معاينة ملخص الأوردرات" },
    { path: "statement", label: "تحميل كشف حساب PDF", preview: "معاينة كشف الحساب" },
  ];
  return (
    <section aria-labelledby="docs-heading" className="rounded-2xl border border-line bg-surface p-4">
      <h2 id="docs-heading" className="font-display text-[1.05rem] font-semibold">
        مستندات العميل
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-graphite">ملفات PDF من البيانات الحالية. سيب التاريخين فاضيين لكل الأوردرات، أو اختار فترة (بتاريخ الأوردر).</p>
      <form method="get" className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-graphite">
            من
            <input type="date" name="from" className="mt-1 block h-11 w-full rounded-xl border border-input bg-surface px-2 text-sm text-ink" />
          </label>
          <label className="text-xs text-graphite">
            لحد
            <input type="date" name="to" className="mt-1 block h-11 w-full rounded-xl border border-input bg-surface px-2 text-sm text-ink" />
          </label>
        </div>
        {docs.map((d) => (
          <div key={d.path} className="flex gap-2">
            <button type="submit" formAction={`${base}/${d.path}`} name="download" value="1" className={primary} data-testid={`doc-${d.path}`}>
              <FileDown className="size-5 shrink-0" aria-hidden="true" />
              {d.label}
            </button>
            <button type="submit" formAction={`${base}/${d.path}`} formTarget="_blank" name="download" value="0" className={secondary} aria-label={d.preview}>
              <Eye className="size-4" aria-hidden="true" />
              معاينة
            </button>
          </div>
        ))}
      </form>
    </section>
  );
}
