import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { formatDateTimeAr } from "@/lib/dates";
import { drawLine, lineWidth, wrapLogical } from "./arabic-text";

/**
 * A4 Arabic document shell on PDFKit: graphite header band with the approved
 * logo, right-to-left text, tables whose header row repeats on every page,
 * and "page X of Y" footers. Colours follow the light theme tokens.
 */

const ROOT = process.cwd();
const FONT_DIR = path.join(ROOT, "src/server/documents/fonts");
const LOGO = path.join(ROOT, "public/brand/benuuprint-logo-512.png");

let assets: { regular: Buffer; semibold: Buffer; bold: Buffer; logo: Buffer } | undefined;
function loadAssets() {
  assets ??= {
    regular: readFileSync(path.join(FONT_DIR, "IBMPlexSansArabic-Regular.ttf")),
    semibold: readFileSync(path.join(FONT_DIR, "IBMPlexSansArabic-SemiBold.ttf")),
    bold: readFileSync(path.join(FONT_DIR, "IBMPlexSansArabic-Bold.ttf")),
    logo: readFileSync(LOGO),
  };
  return assets;
}

export const C = {
  ink: "#171a20",
  muted: "#565e6b",
  line: "#e1e6ec",
  well: "#f1f4f8",
  panel: "#171a20",
  onPanelMuted: "#b9c0ca",
  brand: "#2864c5",
  brandSoft: "#e7eef9",
  success: "#1e8a4c",
  warning: "#8a5a08",
  warningSoft: "#fbf1de",
  danger: "#c4372f",
  dangerSoft: "#fbe9e7",
} as const;

type FontName = "regular" | "semibold" | "bold";
type Align = "right" | "left" | "center";

export type Column<Row> = {
  header: string;
  /** Share of the content width (columns are laid out right to left). */
  width: number;
  align?: Align;
  value: (row: Row) => string;
  font?: FontName;
};

const PAGE = { width: 595.28, height: 841.89 };
const M = { side: 40, top: 40, bottom: 64 };

export class PdfDoc {
  readonly doc: PDFKit.PDFDocument;
  readonly left = M.side;
  readonly right = PAGE.width - M.side;
  readonly width = PAGE.width - 2 * M.side;
  y = M.top;
  private readonly bottom = PAGE.height - M.bottom;
  private readonly generatedAt: Date;
  private readonly runningTitle: string;

  constructor(opts: { title: string; runningTitle: string; generatedAt: Date }) {
    const a = loadAssets();
    this.generatedAt = opts.generatedAt;
    this.runningTitle = opts.runningTitle;
    this.doc = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
      autoFirstPage: true,
      lang: "ar",
      displayTitle: true,
      info: { Title: opts.title, Author: "Benuuprint", Creator: "Benuuprint ERP", Producer: "Benuuprint ERP" },
    });
    this.doc.registerFont("regular", a.regular);
    this.doc.registerFont("semibold", a.semibold);
    this.doc.registerFont("bold", a.bold);
    this.doc.font("regular");
  }

  private use(font: FontName, size: number, color: string = C.ink) {
    this.doc.font(font).fontSize(size).fillColor(color);
  }

  /** Wrapped right-to-left text between `left` and `right`; returns its height. */
  textAt(text: string, o: { left: number; right: number; y: number; size?: number; font?: FontName; color?: string; align?: Align; lineHeight?: number; maxLines?: number }): number {
    const size = o.size ?? 10;
    this.use(o.font ?? "regular", size, o.color);
    const lh = o.lineHeight ?? size * 1.55;
    const width = o.right - o.left;
    let lines = wrapLogical(text, width, (s) => lineWidth(this.doc, s));
    if (o.maxLines && lines.length > o.maxLines) {
      // Keep the first lines; shorten the last one with an ellipsis.
      lines = lines.slice(0, o.maxLines);
      let last = `${lines[o.maxLines - 1]}…`;
      while (last.length > 1 && lineWidth(this.doc, last) > width) last = `${[...last].slice(0, -2).join("")}…`;
      lines[o.maxLines - 1] = last;
    }
    lines.forEach((line, i) => drawLine(this.doc, line, { left: o.left, right: o.right, y: o.y + i * lh, align: o.align ?? "right" }));
    return lines.length * lh;
  }

  measure(text: string, width: number, size = 10, font: FontName = "regular", lineHeight?: number): number {
    this.use(font, size);
    return wrapLogical(text, width, (s) => lineWidth(this.doc, s)).length * (lineHeight ?? size * 1.55);
  }

  /** Adds a page (with the running header) when `height` doesn't fit. */
  ensure(height: number): boolean {
    if (this.y + height <= this.bottom) return false;
    this.doc.addPage();
    this.y = M.top;
    this.textAt(this.runningTitle, { left: this.left, right: this.right, y: this.y, size: 9, font: "semibold", color: C.muted });
    this.doc.moveTo(this.left, this.y + 18).lineTo(this.right, this.y + 18).lineWidth(0.6).strokeColor(C.line).stroke();
    this.y += 28;
    return true;
  }

  /** Graphite band with the logo (right), the title, and a reference (left). */
  header(title: string, subtitle: string, reference: string) {
    const h = 104;
    this.doc.rect(0, 0, PAGE.width, h).fill(C.panel);
    const logoH = 66;
    const logoW = (logoH * 512) / 492;
    this.doc.image(loadAssets().logo, this.right - logoW, (h - logoH) / 2, { height: logoH });
    const titleRight = this.right - logoW - 18;
    this.textAt(title, { left: this.left + 150, right: titleRight, y: 30, size: 20, font: "bold", color: "#ffffff", maxLines: 1 });
    this.textAt(subtitle, { left: this.left + 150, right: titleRight, y: 62, size: 9.5, color: C.onPanelMuted });
    this.textAt(reference, { left: this.left, right: this.left + 145, y: 30, size: 13, font: "semibold", color: "#ffffff", align: "left", maxLines: 2, lineHeight: 20 });
    this.y = h + 22;
  }

  sectionTitle(text: string) {
    this.ensure(46);
    this.doc.rect(this.right - 3, this.y + 3, 3, 13).fill(C.brand);
    this.textAt(text, { left: this.left, right: this.right - 9, y: this.y, size: 12, font: "semibold" });
    this.y += 24;
  }

  /** Label/value pairs in two columns. */
  keyValues(pairs: [string, string][]) {
    const colW = (this.width - 16) / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      const row = pairs.slice(i, i + 2);
      const h = Math.max(...row.map(([, v]) => this.measure(v || "—", colW, 10.5, "semibold"))) + 15;
      this.ensure(h + 6);
      row.forEach(([label, value], j) => {
        const r = this.right - j * (colW + 16);
        this.textAt(label, { left: r - colW, right: r, y: this.y, size: 8.5, color: C.muted });
        this.textAt(value || "—", { left: r - colW, right: r, y: this.y + 13, size: 10.5, font: "semibold" });
      });
      this.y += h + 6;
    }
    this.y += 4;
  }

  /** A coloured box with a short message (warning / info / danger). */
  callout(text: string, tone: "warning" | "info" | "danger") {
    const bg = tone === "warning" ? C.warningSoft : tone === "danger" ? C.dangerSoft : C.well;
    const fg = tone === "warning" ? C.warning : tone === "danger" ? C.danger : C.muted;
    const pad = 9;
    const h = this.measure(text, this.width - 2 * pad, 9.5, "semibold") + 2 * pad - 4;
    this.ensure(h + 8);
    this.doc.roundedRect(this.left, this.y, this.width, h, 6).fill(bg);
    this.textAt(text, { left: this.left + pad, right: this.right - pad, y: this.y + pad - 1, size: 9.5, font: "semibold", color: fg });
    this.y += h + 10;
  }

  paragraph(text: string, size = 9, color: string = C.muted) {
    const h = this.measure(text, this.width, size);
    this.ensure(h);
    this.y += this.textAt(text, { left: this.left, right: this.right, y: this.y, size, color });
  }

  /**
   * Table laid out right to left. Long cells wrap; a row never splits across
   * pages; the header row is repeated at the top of every new page.
   */
  table<Row>(columns: Column<Row>[], rows: Row[], opts: { tone?: (row: Row) => { color?: string; fill?: string; strike?: boolean } | undefined } = {}) {
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const pad = 5;
    const size = 9;
    const lh = size * 1.5;

    const drawHeader = () => {
      const h = Math.max(...columns.map((c, i) => this.measure(c.header, widths[i]! - 2 * pad, 8.5, "semibold", 8.5 * 1.45))) + 2 * pad;
      this.doc.rect(this.left, this.y, this.width, h).fill(C.brandSoft);
      let r = this.right;
      columns.forEach((c, i) => {
        this.textAt(c.header, { left: r - widths[i]! + pad, right: r - pad, y: this.y + pad - 1, size: 8.5, font: "semibold", color: "#1d4c99", align: c.align ?? "right", lineHeight: 8.5 * 1.45 });
        r -= widths[i]!;
      });
      this.y += h;
    };

    this.ensure(60);
    drawHeader();
    rows.forEach((row, index) => {
      const cells = columns.map((c) => c.value(row) || "—");
      const h = Math.max(...cells.map((t, i) => this.measure(t, widths[i]! - 2 * pad, size, columns[i]!.font ?? "regular", lh))) + 2 * pad;
      if (this.ensure(h)) drawHeader();
      const tone = opts.tone?.(row);
      if (tone?.fill) this.doc.rect(this.left, this.y, this.width, h).fill(tone.fill);
      else if (index % 2 === 1) this.doc.rect(this.left, this.y, this.width, h).fill("#fafbfc");
      let r = this.right;
      cells.forEach((t, i) => {
        const col = columns[i]!;
        this.textAt(t, { left: r - widths[i]! + pad, right: r - pad, y: this.y + pad - 1, size, font: col.font ?? "regular", color: tone?.color ?? C.ink, align: col.align ?? "right", lineHeight: lh });
        r -= widths[i]!;
      });
      if (tone?.strike) {
        this.doc.moveTo(this.left + 4, this.y + h / 2).lineTo(this.right - 4, this.y + h / 2).lineWidth(0.5).strokeColor(C.muted).stroke();
      }
      this.doc.moveTo(this.left, this.y + h).lineTo(this.right, this.y + h).lineWidth(0.5).strokeColor(C.line).stroke();
      this.y += h;
    });
    this.y += 12;
  }

  /** Right-aligned totals box: label on the right, amount on the left. */
  totals(lines: { label: string; value: string; strong?: boolean; color?: string }[]) {
    const pad = 10;
    const rowH = 21;
    const h = lines.length * rowH + 2 * pad - 4;
    this.ensure(h + 10);
    const boxW = Math.min(this.width, 330);
    const boxLeft = this.right - boxW;
    this.doc.roundedRect(boxLeft, this.y, boxW, h, 8).lineWidth(0.8).fillAndStroke(C.well, C.line);
    lines.forEach((l, i) => {
      const y = this.y + pad + i * rowH;
      if (l.strong && i > 0) this.doc.moveTo(boxLeft + pad, y - 4).lineTo(this.right - pad, y - 4).lineWidth(0.6).strokeColor(C.line).stroke();
      this.textAt(l.label, { left: boxLeft + pad + 120, right: this.right - pad, y, size: l.strong ? 10.5 : 9.5, font: l.strong ? "bold" : "regular", color: l.color ?? C.ink });
      this.textAt(l.value, { left: boxLeft + pad, right: boxLeft + pad + 150, y, size: l.strong ? 11 : 10, font: l.strong ? "bold" : "semibold", color: l.color ?? C.ink, align: "left" });
    });
    this.y += h + 14;
  }

  /** Footers on every page, then the finished file. */
  finish(): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    const stamp = `اتعمل من البيانات الحالية في ${formatDateTimeAr(this.generatedAt)} — مستند تجاري غير ضريبي`;
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const y = PAGE.height - 42;
      this.doc.moveTo(this.left, y - 6).lineTo(this.right, y - 6).lineWidth(0.5).strokeColor(C.line).stroke();
      this.textAt(`Benuuprint · ${stamp}`, { left: this.left + 90, right: this.right, y, size: 7.5, color: C.muted });
      this.textAt(`صفحة ${i - range.start + 1} من ${range.count}`, { left: this.left, right: this.left + 85, y, size: 7.5, color: C.muted, align: "left" });
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      this.doc.on("data", (c: Buffer) => chunks.push(c));
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
      this.doc.end();
    });
  }
}

