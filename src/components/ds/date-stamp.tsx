import { daysUntil } from "@/lib/dates";
import { cn } from "@/lib/utils";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/**
 * The due date set like a rubber stamp: the day large, the month beneath.
 * Overdue turns register red, due today turns violet.
 */
export function DateStamp({ date, open = true, className }: { date: string; open?: boolean; className?: string }) {
  const [, m, d] = date.split("-").map(Number);
  const left = daysUntil(date);
  const tone = !open ? "plain" : left < 0 ? "late" : left === 0 ? "today" : "plain";
  return (
    <span
      className={cn(
        "flex w-12 shrink-0 flex-col items-center justify-center leading-none",
        tone === "late" && "text-register",
        tone === "today" && "text-violet",
        tone === "plain" && "text-ink",
        className,
      )}
    >
      <span className="tabular font-display text-[1.6rem] font-semibold tracking-[-0.03em]">{d}</span>
      <span className="mt-1 text-[0.68rem] font-medium">{MONTHS[(m ?? 1) - 1]}</span>
    </span>
  );
}

/** "متأخر ٣ يوم" / "النهارده" / "فاضل ٥ أيام" in plain Egyptian Arabic. */
export function dueText(date: string): { text: string; tone: "late" | "today" | "soon" | "plain" } {
  const d = daysUntil(date);
  if (d < 0) return { text: `متأخر ${-d} يوم`, tone: "late" };
  if (d === 0) return { text: "التسليم النهارده", tone: "today" };
  if (d === 1) return { text: "التسليم بكرة", tone: "soon" };
  if (d > 45) return { text: "فاضل أكتر من شهر", tone: "plain" };
  return { text: `فاضل ${d} ${d <= 10 ? "أيام" : "يوم"}`, tone: d <= 3 ? "soon" : "plain" };
}
