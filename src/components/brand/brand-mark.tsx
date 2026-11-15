import { cn } from "@/lib/utils";

/**
 * Benuuprint mark: a rounded purple tile with a "B" and three ink dots
 * (cyan, magenta, yellow) — a quiet nod to print.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("size-10 shrink-0", className)}
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="13" fill="#4b1fa0" />
      <g transform="translate(-4 0)">
      <path
        d="M16 12h10.2c5 0 8.3 2.6 8.3 6.7 0 2.6-1.4 4.6-3.7 5.5 3 .8 4.9 3.1 4.9 6.2 0 4.6-3.6 7.6-9 7.6H16V12Zm6 10.3h3.6c2 0 3.2-1 3.2-2.7s-1.2-2.6-3.2-2.6H22v5.3Zm0 10.7h4.2c2.2 0 3.5-1.1 3.5-2.9s-1.3-2.9-3.5-2.9H22V33Z"
        fill="#fff"
      />
      <circle cx="38" cy="11" r="2.4" fill="#22c3e6" />
      <circle cx="38" cy="18" r="2.4" fill="#f0368c" />
      <circle cx="38" cy="25" r="2.4" fill="#ffd23f" />
      </g>
    </svg>
  );
}

export function BrandName({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={cn("font-bold tracking-tight text-foreground", className)}>
      Benuu<span className="text-primary">print</span>
    </span>
  );
}
