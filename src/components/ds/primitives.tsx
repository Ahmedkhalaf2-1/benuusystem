import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One brand: every action and section uses the sapphire accent. The only
 * exception is meaning — "red" marks destructive or overdue things. (The old
 * per-module names are kept as keys so call sites read naturally.)
 */
const BRAND = { solid: "bg-brand-soft text-brand-ink", soft: "bg-brand-soft", ink: "text-brand-ink" };
export const HUE = {
  violet: BRAND,
  blue: BRAND,
  teal: BRAND,
  green: BRAND,
  amber: BRAND,
  rose: BRAND,
  red: { solid: "bg-danger-soft text-danger-ink", soft: "bg-danger-soft", ink: "text-danger-ink" },
} as const;
export type Hue = keyof typeof HUE;

/** A solid rounded square with a white glyph, in an action hue. */
export function HueIcon({ icon: Icon, hue, size = "md", className }: { icon: LucideIcon; hue: Hue; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        HUE[hue].solid,
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
    <section id={id} className={cn("scroll-mt-20 rounded-2xl bg-surface p-4 border border-line sm:p-5", className)}>
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
    <div className="rounded-2xl border-2 border-dashed border-line-strong bg-surface px-5 py-9 text-center">
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
      <div className="rounded-2xl bg-canvas p-1.5">{children}</div>
    </div>
  );
}

/** The one primary action of a workflow form: sapphire, or red when it destroys. */
export function hueSubmit(hue: Hue) {
  return cn(
    "flex h-14 w-full items-center justify-center gap-2 rounded-xl font-display text-lg font-semibold text-on-brand transition-[background-color,transform] active:scale-[0.99] disabled:opacity-50",
    hue === "red" ? "bg-danger-solid hover:opacity-90" : "bg-brand-solid hover:bg-brand-hover",
  );
}

/** Keeps a form's primary action in thumb reach, above the phone tab bar. */
export const STICKY_SUBMIT = "sticky bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 -mx-1.5 rounded-2xl border border-line bg-surface p-1.5 lg:bottom-4";
