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
    <div className="mb-5 space-y-2">
      {backHref && (
        <Link
          href={backHref}
          className="-ms-1 inline-flex h-9 items-center gap-1 rounded-lg px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}
