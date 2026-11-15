import type { LucideIcon } from "lucide-react";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** The one consistent "not built yet" state, used instead of fake screens. */
export function ComingSoon({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <section className="flex flex-col items-center rounded-[1.6rem] border-2 border-dashed border-[#d9d2ea] bg-surface/60 px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-violet-soft text-violet">
        <Icon className="size-7" aria-hidden="true" />
      </span>
      <Badge variant="secondary" className="mt-5 h-6 gap-1.5 px-2.5 text-xs">
        <Clock aria-hidden="true" />
        قريبًا
      </Badge>
      <h1 className="mt-3 font-display text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
    </section>
  );
}

export function SoonBadge() {
  return (
    <Badge variant="secondary" className="h-5 px-2 text-[0.7rem] font-medium">
      قريبًا
    </Badge>
  );
}
