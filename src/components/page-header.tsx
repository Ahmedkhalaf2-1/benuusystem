import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

/** Page title with an optional back link (→ in RTL) and action. */
export function PageHeader({
  title,
  backHref,
  backLabel = "رجوع",
  action,
  subtitle,
}: {
  title: ReactNode;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="mb-5 space-y-1.5">
      {backHref && (
        <Link
          href={backHref}
          className="-ms-1 inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-graphite hover:bg-surface hover:text-ink"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] leading-[1.35] font-semibold tracking-[-0.02em]">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-graphite">{subtitle}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

/** Just the "← back" link, for pages whose content carries its own heading. */
export function BackLink({ href, label = "رجوع" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="-ms-1 mb-2 inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-graphite hover:bg-surface hover:text-ink">
      <ArrowRight className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
