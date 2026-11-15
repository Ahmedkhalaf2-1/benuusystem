import { normalizeDigits } from "@/lib/numbers";

/**
 * Garment sizes: plain labels with quantities — not variants or SKUs.
 * Safe for client and server.
 */

/** The quick-pick sizes. Any other label (numeric, children's…) is allowed too. */
export const COMMON_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"] as const;

export const MAX_SIZES_PER_GROUP = 30;

/**
 * Normalizes how a size is written WITHOUT changing what it means:
 * Arabic digits → 0-9, trimmed, single spaces, Latin letters upper-cased,
 * and "2 XL" → "2XL". "XXL" stays "XXL"; «10 سنين» stays «10 سنين».
 */
export function normalizeSizeLabel(input: string): string {
  return normalizeDigits(input)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[a-z]/g, (c) => c.toUpperCase())
    .replace(/^(\d)\s+(X+[SL])$/, "$1$2");
}

/** Product types that are clothing: the size breakdown is switched on for them by default. */
const CLOTHING_WORDS = ["تيشيرت", "تي شيرت", "بولو", "هودي", "سويت", "قميص", "جاكيت", "بنطلون", "يونيفورم", "زي", "فستان", "بلوزة", "جيليه", "ترينج", "شورت", "عباية", "سويتشيرت"];

export function isClothingProduct(productType: string): boolean {
  const p = productType.trim();
  return p.length > 0 && CLOTHING_WORDS.some((w) => p.includes(w));
}

/** Orders sizes for display: common sizes in their natural order, then the rest as entered. */
export function sizeSortKey(label: string): number {
  const i = (COMMON_SIZES as readonly string[]).indexOf(label);
  return i === -1 ? 100 : i;
}
