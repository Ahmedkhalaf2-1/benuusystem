import { cn } from "@/lib/utils";

/** Initial-letter avatar; no external images. */
export function UserAvatar({ name, className }: { name: string; className?: string }) {
  const initial = name.trim().charAt(0) || "؟";
  return (
    <span
      aria-hidden="true"
      className={cn(
        // A filled sapphire-tint disc with a bold initial: thin Arabic letters
        // (أ، ا) read as a Latin "i" in a hairline outline.
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-[1.05em] font-bold text-brand-ink ring-1 ring-line",
        className,
      )}
    >
      {initial}
    </span>
  );
}
