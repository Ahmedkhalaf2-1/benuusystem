import "server-only";
import { todayDateString } from "@/lib/dates";

/** Characters that are unsafe in file names on any OS. */
function safeName(text: string): string {
  return text.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * A private PDF response. `?download=1` → attachment (saves the file),
 * otherwise inline (opens in the browser's viewer for preview, print, share).
 * Never stored by shared caches.
 */
export function pdfResponse(body: Buffer, request: Request, names: { arabic: string; ascii: string }): Response {
  const download = new URL(request.url).searchParams.get("download") === "1";
  const date = todayDateString();
  const arabic = `${safeName(names.arabic)} - ${date}.pdf`;
  const ascii = `${names.ascii.replace(/[^A-Za-z0-9._-]+/g, "-")}-${date}.pdf`;
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(body.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(arabic)}`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex",
    },
  });
}
