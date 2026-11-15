// Derives every brand asset from the approved logo (the single source of truth):
//   public/benuuprint-3d.png  — silver/white 3D logo, transparent, 1254×1254.
// Usage: npm run icons   (uses `sharp`, which ships with Next.js)
//
// Outputs
//   public/brand/benuuprint-logo-{512,1024}.png  full logo, trimmed, transparent
//   public/brand/benuuprint-symbol-{128,256,512}.png  symbol only, transparent
//   public/icons/icon-{192,512}.png, maskable-512.png  PWA (symbol on a graphite tile)
//   src/app/icon.png (favicon), src/app/apple-icon.png (iOS home screen)
// The logo itself is never recoloured, re-lit or given effects; small icons use
// the symbol alone (the wordmark is unreadable at favicon sizes) on solid graphite,
// because the mark is white and needs a dark field to be seen on light browsers.
import { mkdir, rm } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "public/benuuprint-3d.png";
const GRAPHITE = "#171A20";

async function fullLogo() {
  return sharp(SOURCE).trim({ threshold: 1 }).png().toBuffer();
}

/**
 * The symbol is the upper mark. It is separated from the wordmark bar by a
 * transparent gap that runs diagonally (the bar is drawn in perspective), so
 * the bar is removed along that gap line, then the result is trimmed.
 */
async function symbol() {
  const L = 280, T = 115, W = 740, H = 700;
  const { data } = await sharp(SOURCE).extract({ left: L, top: T, width: W, height: H }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (y > 688 - (x - 300) * 0.136) data[(y * W + x) * 4 + 3] = 0;
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer();
}

/** The symbol centred on a graphite square; `pad` = share of the side left empty around it. */
async function tile(sym, size, pad, rounded) {
  const inner = Math.round(size * (1 - pad));
  const mark = await sharp(sym).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const r = rounded ? Math.round(size * 0.22) : 0;
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${GRAPHITE}"/></svg>`);
  return sharp(bg).composite([{ input: mark, gravity: "center" }]).png({ compressionLevel: 9 });
}

await mkdir("public/brand", { recursive: true });
await mkdir("public/icons", { recursive: true });
const logo = await fullLogo();
const sym = await symbol();
for (const w of [512, 1024]) {
  await sharp(logo).resize({ width: w }).png({ compressionLevel: 9 }).toFile(`public/brand/benuuprint-logo-${w}.png`);
  console.log("wrote", `public/brand/benuuprint-logo-${w}.png`);
}
for (const h of [128, 256, 512]) {
  await sharp(sym).resize({ height: h }).png({ compressionLevel: 9 }).toFile(`public/brand/benuuprint-symbol-${h}.png`);
  console.log("wrote", `public/brand/benuuprint-symbol-${h}.png`);
}
await (await tile(sym, 192, 0.3, true)).toFile("public/icons/icon-192.png");
await (await tile(sym, 512, 0.3, true)).toFile("public/icons/icon-512.png");
// Maskable: full-bleed, mark inside the 80% safe zone.
await (await tile(sym, 512, 0.42, false)).toFile("public/icons/maskable-512.png");
await (await tile(sym, 180, 0.32, false)).toFile("src/app/apple-icon.png");
await (await tile(sym, 96, 0.24, true)).toFile("src/app/icon.png");
await rm("src/app/icon.svg", { force: true });
console.log("wrote icons (public/icons, src/app/icon.png, src/app/apple-icon.png)");
