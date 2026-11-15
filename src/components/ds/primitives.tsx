import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Action hues. Each daily action owns one, and the same hue marks that kind of
 * work everywhere (quick actions, flow headers, history, status).
 */
export const HUE = {
  violet: { solid: "bg-violet", soft: "bg-violet-soft", ink: "text-violet", glow: "shadow-[var(--shadow-violet)]" },
  blue: { solid: "bg-blue", soft: "bg-blue-soft", ink: "text-blue-ink", glow: "shadow-[0_8px_18px_-8px_rgb(47_107_234/0.7)]" },
  teal: { solid: "bg-teal", soft: "bg-teal-soft", ink: "text-teal-ink", glow: "shadow-[0_8px_18px_-8px_rgb(18_165_148/0.7)]" },
  green: { solid: "bg-green", soft: "bg-green-soft", ink: "text-green-ink", glow: "shadow-[0_8px_18px_-8px_rgb(34_160_90/0.7)]" },
  amber: { solid: "bg-amber", soft: "bg-amber-soft", ink: "text-amber-ink", glow: "shadow-[0_8px_18px_-8px_rgb(232_150_12/0.7)]" },
  rose: { solid: "bg-rose", soft: "bg-rose-soft", ink: "text-rose-ink", glow: "shadow-[0_8px_18px_-8px_rgb(224_69_123/0.7)]" },
  red: { solid: "bg-red", soft: "bg-red-soft", ink: "text-red", glow: "shadow-[0_8px_18px_-8px_rgb(220_59_59/0.7)]" },
} as const;
export type Hue = keyof typeof HUE;

/** A solid rounded square with a white glyph, in an action hue. */
export function HueIcon({ icon: Icon, hue, size = "md", className }: { icon: LucideIcon; hue: Hue; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center text-white",
        HUE[hue].solid,
        HUE[hue].glow,
        size === "sm" ? "size-9 rounded-xl" : size === "md" ? "size-11 rounded-2xl" : "size-13 rounded-2xl",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-[1.1rem]" : size === "md" ? "size-5" : "size-6"} aria-hidden="true" />
    </span>
  );
}

/** A soft rounded square with a coloured glyph — for section markers inside cards. */
export function SoftIcon({ icon: Icon, hue, className }: { icon: LucideIcon; hue: Hue; className?: string }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", HUE[hue].soft, HUE[hue].ink, className)}>
      <Icon className="size-[1.1rem]" aria-hidden="true" />
    </span>
  );
}

/**
 * Header for a workflow screen (record production, pay a supplier…): back
 * link, the action's coloured mark, its name, and what it is being done to.
 */
export function FlowHeader({
  icon,
  hue,
  title,
  context,
  backHref,
  backLabel = "رجوع",
  action,
}: {
  icon: LucideIcon;
  hue: Hue;
  title: string;
  context?: ReactNode;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {backHref && (
        <Link
          href={backHref}
          className="-ms-1 mb-2 inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-graphite hover:bg-surface hover:text-ink"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      <div className="flex items-center gap-3">
        <HueIcon icon={icon} hue={hue} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.55rem] leading-[1.4] font-semibold tracking-[-0.02em]">{title}</h1>
          {context && <div className="truncate text-sm text-graphite">{context}</div>}
        </div>
        {action}
      </div>
    </header>
  );
}

/** A raised card for one step of a workflow or one block of a page. */
export function FlowCard({
  title,
  icon,
  hue = "violet",
  aside,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  hue?: Hue;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 rounded-[1.5rem] bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5", className)}>
      {title && (
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 font-display text-[1.05rem] font-semibold">
            {icon && <SoftIcon icon={icon} hue={hue} />}
            {title}
          </h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** A calm empty state: what will appear here, and the one action that starts it. */
export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[1.6rem] border-2 border-dashed border-[#d9d2ea] bg-surface/60 px-5 py-9 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-violet-soft text-violet">
        <Icon className="size-7" aria-hidden="true" />
      </span>
      <p className="mt-3 font-display text-lg font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-[34ch] text-sm leading-relaxed text-graphite">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Sticky submit area that floats above the phone tab bar. */
export function SubmitBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("sticky bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4", className)}>
      <div className="rounded-[1.4rem] bg-canvas/80 p-1.5 backdrop-blur-xl">{children}</div>
    </div>
  );
}

const SUBMIT: Record<Hue, string> = {
  violet: "from-[#6d47ea] to-violet-deep shadow-[var(--shadow-violet)]",
  blue: "from-[#3d7cf2] to-blue-ink shadow-[0_14px_30px_-12px_rgb(47_107_234/0.75)]",
  teal: "from-[#19b8a5] to-teal-ink shadow-[0_14px_30px_-12px_rgb(18_165_148/0.75)]",
  green: "from-[#2bb469] to-green-ink shadow-[0_14px_30px_-12px_rgb(34_160_90/0.75)]",
  amber: "from-[#f2a623] to-amber-ink shadow-[0_14px_30px_-12px_rgb(232_150_12/0.75)]",
  rose: "from-[#e8558a] to-rose-ink shadow-[0_14px_30px_-12px_rgb(224_69_123/0.75)]",
  red: "from-[#e35151] to-[#b92a2a] shadow-[0_14px_30px_-12px_rgb(220_59_59/0.75)]",
};

/** The one primary action of a workflow form, in that workflow's hue. */
export function hueSubmit(hue: Hue) {
  return cn(
    "flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b font-display text-lg font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50",
    SUBMIT[hue],
  );
}

/** Keeps a form's primary action in thumb reach, above the phone tab bar. */
export const STICKY_SUBMIT = "sticky bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 -mx-1.5 rounded-[1.4rem] bg-surface/80 p-1.5 backdrop-blur-xl lg:bottom-4";
