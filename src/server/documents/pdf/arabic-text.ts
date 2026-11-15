import bidiFactory from "bidi-js";

/**
 * Right-to-left text for PDFKit.
 *
 * PDFKit (via fontkit) shapes Arabic correctly — joined letter forms and
 * ligatures — and returns an all-Arabic run in visual order. It does not run
 * the Unicode bidi algorithm, so mixed text such as "أوردر #0012" or
 * "40,000 ج.م" would come out with numbers and Latin words reversed.
 *
 * Here each line is split into runs of one direction (Unicode Bidirectional
 * Algorithm, base direction RTL), runs are put in visual order (rule L2),
 * mirrored characters such as brackets are swapped inside RTL runs, and each
 * run is then drawn left-to-right by PDFKit.
 */

const bidi = bidiFactory();
const ARABIC = /\p{Script=Arabic}/u;

export type VisualRun = { text: string; rtl: boolean };

/** Bidi isolate marks: used to keep e.g. "#0012" as one LTR unit; never drawn. */
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const ISOLATES = new RegExp(`[${String.fromCodePoint(0x2066)}-${String.fromCodePoint(0x2069)}]`, "g");

/** Wraps text that must stay left-to-right (order numbers, codes) in an isolate. */
export function ltr(text: string): string {
  return `${LRI}${text}${PDI}`;
}

/** Splits one line (no newlines) into runs in left-to-right drawing order. */
export function visualRuns(line: string, baseDirection: "rtl" | "ltr" = "rtl"): VisualRun[] {
  if (line === "") return [];
  const embedding = bidi.getEmbeddingLevels(line, baseDirection);
  const { levels } = embedding;
  const mirrored = bidi.getMirroredCharactersMap(line, levels);

  // Runs of equal embedding level, in logical order.
  const runs: { start: number; end: number; level: number }[] = [];
  for (let i = 0; i < line.length; i++) {
    const level = levels[i]!;
    const last = runs.at(-1);
    if (last && last.level === level) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, level });
  }

  // Rule L2: from the highest level down to the lowest odd level, reverse
  // every maximal sequence of runs at that level or higher.
  const max = Math.max(...runs.map((r) => r.level));
  const minOdd = Math.min(...runs.map((r) => r.level).filter((l) => l % 2 === 1), max + 1);
  for (let level = max; level >= minOdd && level > 0; level--) {
    for (let i = 0; i < runs.length; ) {
      if (runs[i]!.level < level) {
        i++;
        continue;
      }
      let j = i;
      while (j < runs.length && runs[j]!.level >= level) j++;
      runs.splice(i, j - i, ...runs.slice(i, j).reverse());
      i = j;
    }
  }

  return runs.map(({ start, end, level }) => {
    const rtl = level % 2 === 1;
    let text = "";
    // Brackets etc. take their mirrored glyph in RTL runs (fontkit doesn't).
    for (let i = start; i < end; i++) text += (rtl && mirrored.get(i)) || line[i];
    // fontkit reverses a run containing Arabic letters by itself; a run of
    // RTL neutrals only, e.g. " (" or " - ", is reversed here.
    if (rtl && !ARABIC.test(text)) text = [...text].reverse().join("");
    return { text: text.replace(ISOLATES, ""), rtl };
  }).filter((run) => run.text !== "");
}

/**
 * Greedy word wrap on the LOGICAL text (widths don't depend on order).
 * Words longer than the width are broken by characters.
 */
export function wrapLogical(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      if (measure(word) <= width) {
        line = word;
        continue;
      }
      // Break an over-long word.
      let piece = "";
      for (const ch of word) {
        if (measure(piece + ch) > width && piece) {
          out.push(piece);
          piece = ch;
        } else piece += ch;
      }
      line = piece;
    }
    out.push(line);
  }
  return out;
}

/**
 * Always passed to PDFKit: with explicit features it shapes each run as a
 * whole. Without them it lays text out word by word (for caching), which
 * breaks the word order inside an RTL run.
 */
export const FONT_FEATURES: PDFKit.Mixins.OpenTypeFeatures[] = ["kern", "liga", "rlig", "calt"];

type TextDoc = Pick<PDFKit.PDFDocument, "widthOfString" | "text">;
const OPTS: PDFKit.Mixins.TextOptions = { features: FONT_FEATURES };

/** Width of one line as it will be drawn. */
export function lineWidth(doc: TextDoc, line: string): number {
  return visualRuns(line).reduce((sum, run) => sum + doc.widthOfString(run.text, OPTS), 0);
}

/**
 * Draws one line with its right edge at `right` (RTL), its left edge at
 * `left`, or centred between them. PDFKit trims spaces at the ends of each
 * text call, so edge spaces are measured and skipped here instead.
 */
export function drawLine(doc: TextDoc, line: string, opts: { left: number; right: number; y: number; align: "right" | "left" | "center" }) {
  const runs = visualRuns(line);
  const widths = runs.map((run) => doc.widthOfString(run.text, OPTS));
  const total = widths.reduce((a, b) => a + b, 0);
  let x = opts.align === "left" ? opts.left : opts.align === "right" ? opts.right - total : (opts.left + opts.right - total) / 2;
  runs.forEach((run, i) => {
    // fontkit reverses an Arabic run, so its logical end is drawn on the left.
    const visual = run.rtl && ARABIC.test(run.text) ? [...run.text].reverse().join("") : run.text;
    const leftSpaces = visual.length - visual.trimStart().length;
    const core = run.text.trim();
    if (core) doc.text(core, x + (leftSpaces ? doc.widthOfString(" ".repeat(leftSpaces), OPTS) : 0), opts.y, { ...OPTS, lineBreak: false });
    x += widths[i]!;
  });
}
