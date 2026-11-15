import { cn } from "@/lib/utils";

/** Initial-letter avatar; no external images. */
export function UserAvatar({ name, className }: { name: string; className?: string }) {
  const initial = name.trim().charAt(0) || "؟";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ffd56a] via-[#ff7aa8] to-[#6d47ea] p-[2px]",
        className,
      )}
    >
      <span className="flex size-full items-center justify-center rounded-full bg-surface font-display text-sm font-semibold text-violet">{initial}</span>
    </span>
  );
}
