import { cn } from "@/lib/utils";

/** Initial-letter avatar; no external images. */
export function UserAvatar({ name, className }: { name: string; className?: string }) {
  const initial = name.trim().charAt(0) || "؟";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-primary",
        className,
      )}
    >
      {initial}
    </span>
  );
}
