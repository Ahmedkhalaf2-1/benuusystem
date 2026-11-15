import { Search } from "lucide-react";
import type { ReactNode } from "react";

/** Plain GET search form — works without JavaScript, keeps hidden filters. */
export function SearchBox({
  action,
  defaultValue,
  placeholder,
  hidden,
}: {
  action: string;
  defaultValue?: string;
  placeholder: string;
  hidden?: Record<string, string | undefined>;
  children?: ReactNode;
}) {
  return (
    <form action={action} method="get" role="search" className="relative">
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-5 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        enterKeyHint="search"
        className="h-12 w-full rounded-xl border border-input bg-surface ps-11 pe-3.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </form>
  );
}
