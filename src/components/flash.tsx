import { CheckCircle2 } from "lucide-react";

/** Success banner shown after a redirect (e.g. ?created=1). */
export function Flash({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-600/20 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"
    >
      <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
      {message}
    </div>
  );
}
