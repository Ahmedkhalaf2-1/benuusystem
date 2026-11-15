/** Shown instantly while a screen loads: the shape of the page, gently pulsing. */
export default function Loading() {
  const block = "animate-pulse rounded-2xl bg-surface border border-line motion-reduce:animate-none";
  return (
    <div role="status" aria-label="جاري التحميل" className="space-y-4">
      <div className="h-36 animate-pulse rounded-2xl bg-track motion-reduce:animate-none" />
      <div className="grid grid-cols-3 gap-2.5">
        <div className={`${block} h-24`} />
        <div className={`${block} h-24`} />
        <div className={`${block} h-24`} />
      </div>
      <div className={`${block} h-28`} />
      <div className={`${block} h-28`} />
      <span className="sr-only">جاري التحميل…</span>
    </div>
  );
}
