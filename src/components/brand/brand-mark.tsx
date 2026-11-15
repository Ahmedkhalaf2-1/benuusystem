import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Benuuprint brand, from the approved artwork (public/benuuprint-3d.png →
 * public/brand/*, see scripts/generate-icons.mjs). The mark is silver/white,
 * so it always sits on solid graphite — never with added shadows or effects.
 */

/** The symbol on a solid graphite tile: header, sidebar, small brand spots. */
export function BrandSymbol({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <span className={cn("relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#171a20] ring-1 ring-line", className)}>
      <Image src="/brand/benuuprint-symbol-128.png" alt="" width={116} height={128} className="h-[72%] w-auto" priority={priority} unoptimized />
    </span>
  );
}

/** The full logo (symbol + wordmark). Only on graphite panels, where it reads. */
export function BrandLogo({ className, priority }: { className?: string; priority?: boolean }) {
  return <Image src="/brand/benuuprint-logo-512.png" alt="Benuuprint" width={512} height={492} className={cn("h-auto w-40", className)} priority={priority} unoptimized />;
}
