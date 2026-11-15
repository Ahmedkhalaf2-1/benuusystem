// Regenerates the PWA / home-screen icons from the Benuuprint mark.
// Usage: npm run icons   (uses `sharp`, which ships with Next.js)
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const PURPLE = "#4b1fa0";

// The "B" and ink dots on a 48×48 grid (same artwork as BrandMark).
const glyph = `<g transform="translate(-4 0)">
  <path d="M16 12h10.2c5 0 8.3 2.6 8.3 6.7 0 2.6-1.4 4.6-3.7 5.5 3 .8 4.9 3.1 4.9 6.2 0 4.6-3.6 7.6-9 7.6H16V12Zm6 10.3h3.6c2 0 3.2-1 3.2-2.7s-1.2-2.6-3.2-2.6H22v5.3Zm0 10.7h4.2c2.2 0 3.5-1.1 3.5-2.9s-1.3-2.9-3.5-2.9H22V33Z" fill="#fff"/>
  <circle cx="38" cy="11" r="2.4" fill="#22c3e6"/>
  <circle cx="38" cy="18" r="2.4" fill="#f0368c"/>
  <circle cx="38" cy="25" r="2.4" fill="#ffd23f"/></g>`;

/** Rounded tile with transparent corners — for browsers and the favicon. */
const roundedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="11" fill="${PURPLE}"/>${glyph}</svg>`;

/** Full-bleed square, artwork scaled into the central safe zone. */
const fullBleedSvg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="${PURPLE}"/>
  <g transform="translate(${24 - 24 * scale} ${24 - 24 * scale}) scale(${scale})">${glyph}</g></svg>`;

async function png(svg, size, file) {
  await sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toFile(file);
  console.log("wrote", file);
}

await mkdir("public/icons", { recursive: true });
await png(roundedSvg, 192, "public/icons/icon-192.png");
await png(roundedSvg, 512, "public/icons/icon-512.png");
await png(fullBleedSvg(0.72), 512, "public/icons/maskable-512.png");
// Next.js file conventions: app/icon.svg (favicon) and app/apple-icon.png (iOS home screen).
await png(fullBleedSvg(0.86), 180, "src/app/apple-icon.png");
await writeFile("src/app/icon.svg", roundedSvg.trim() + "\n");
console.log("wrote src/app/icon.svg");
