import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Label + control + hint + error, with consistent spacing. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  optional,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-1.5 text-[0.95rem] font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">(اختياري)</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const controlClass =
  "w-full min-w-0 rounded-xl border border-input bg-surface px-3.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(controlClass, "h-12 appearance-auto pe-2", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlClass, "min-h-24 py-3 leading-relaxed", className)} {...props} />;
}

export function FormMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
      {message}
    </div>
  );
}

/** A titled white card used to group form sections. */
export function FormSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
