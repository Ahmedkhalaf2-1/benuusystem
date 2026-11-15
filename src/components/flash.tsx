import { CheckCircle2 } from "lucide-react";

/** Success banner shown after a redirect (e.g. ?created=1). */
export function Flash({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="animate-settle mb-4 flex items-center gap-2.5 rounded-2xl bg-green-soft px-4 py-3 text-sm font-semibold text-green-ink shadow-[var(--shadow-soft)]"
    >
      <CheckCircle2 className="size-5 shrink-0 text-green" aria-hidden="true" />
      {message}
    </div>
  );
}
