import { formatNumber } from "@/lib/numbers";
import { cn } from "@/lib/utils";

/**
 * The production bar: delivered (violet), ready and waiting (teal), still to
 * make (track). Physical pieces only. `tone="dark"` is for the violet stage.
 */
export function ProductionTrack({
  required,
  ready,
  delivered,
  unitLabel,
  size = "md",
  tone = "light",
  className,
}: {
  required: number;
  ready: number;
  delivered: number;
  unitLabel?: string;
  size?: "sm" | "md" | "lg";
  tone?: "light" | "dark";
  ticks?: boolean;
  legend?: boolean;
  className?: string;
}) {
  const dark = tone === "dark";
  const pct = (v: number) => (required > 0 ? Math.max(0, Math.min(100, (v / required) * 100)) : 0);
  const deliveredPct = pct(delivered);
  const readyPct = Math.max(0, pct(ready) - deliveredPct);
  const u = unitLabel ? ` ${unitLabel}` : "";
  const label = `اتسلم ${formatNumber(delivered)}${u}، جاهز ولم يسلم ${formatNumber(ready - delivered)}${u}، باقي ${formatNumber(required - ready)}${u} من ${formatNumber(required)}${u}`;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "flex gap-[3px] overflow-hidden rounded-full",
        dark ? "bg-white/15" : "bg-[#ebe7f4]",
        size === "sm" ? "h-1.5" : size === "md" ? "h-2.5" : "h-3.5",
        className,
      )}
    >
      {deliveredPct > 0 && (
        <span
          className={cn("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)]", dark ? "bg-white" : "bg-gradient-to-l from-violet to-[#7b5cf0]")}
          style={{ width: `${deliveredPct}%` }}
        />
      )}
      {readyPct > 0 && (
        <span
          className={cn("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)]", dark ? "bg-[#5eead4]" : "bg-teal")}
          style={{ width: `${readyPct}%` }}
        />
      )}
    </div>
  );
}

/** Legend dot matching the bar. */
export function GaugeSwatch({ kind, dark = false }: { kind: "delivered" | "ready" | "left"; dark?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full",
        kind === "delivered" && (dark ? "bg-white" : "bg-violet"),
        kind === "ready" && (dark ? "bg-[#5eead4]" : "bg-teal"),
        kind === "left" && (dark ? "bg-white/25" : "bg-[#ddd7ea]"),
      )}
    />
  );
}
