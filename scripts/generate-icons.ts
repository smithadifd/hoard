/**
 * Generate PWA icons for Hoard using sharp.
 *
 * Renders a TrendingDown arrow in steam-blue (#1a9fff) on the app
 * background (#0c0a1d). Outputs PNG icons at all required PWA sizes
 * plus favicon.ico and apple-touch-icon.png.
 *
 * Usage: npx tsx scripts/generate-icons.ts
 */

import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const BG = '#0c0a1d';
const FG = '#1a9fff';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

function makeSvg(size: number, padding = 0.2): string {
  const p = Math.round(size * padding);
  const inner = size - p * 2;

  // TrendingDown arrow: a line going down-right with an arrowhead
  const x1 = p;
  const y1 = p + inner * 0.25;
  const xMid = p + inner * 0.5;
  const yMid = p + inner * 0.75;
  const x2 = p + inner;
  const y2 = p + inner * 0.35;

  const strokeW = Math.max(2, Math.round(size * 0.08));
  const arrowSize = Math.round(inner * 0.2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="${BG}"/>
  <polyline points="${x1},${y1} ${xMid},${yMid} ${x2},${y2}"
    fill="none" stroke="${FG}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="${x2 - arrowSize},${y2 - Math.round(arrowSize * 0.3)} ${x2},${y2} ${x2 - Math.round(arrowSize * 0.6)},${y2 + Math.round(arrowSize * 0.7)}"
    fill="none" stroke="${FG}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function makeMaskableSvg(size: number): string {
  // Maskable icons need extra padding (safe zone is inner 80%)
  return makeSvg(size, 0.3);
}

async function generatePng(svg: string, outputPath: string) {
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  console.log(`  Created ${outputPath}`);
}

async function main() {
  console.log('Generating PWA icons...');

  // Standard icons
  for (const size of [192, 512]) {
    await generatePng(
      makeSvg(size),
      join(PUBLIC, 'icons', `icon-${size}x${size}.png`)
    );
  }

  // Maskable icons
  for (const size of [192, 512]) {
    await generatePng(
      makeMaskableSvg(size),
      join(PUBLIC, 'icons', `icon-maskable-${size}x${size}.png`)
    );
  }

  // Apple touch icon (180x180)
  await generatePng(
    makeSvg(180),
    join(PUBLIC, 'apple-touch-icon.png')
  );

  // Favicon (32x32 PNG, then convert to ICO)
  const favicon32Svg = makeSvg(32, 0.1);
  const favicon32Buf = await sharp(Buffer.from(favicon32Svg)).png().toBuffer();
  const favicon16Buf = await sharp(Buffer.from(makeSvg(16, 0.1))).png().toBuffer();

  // ICO format: simple BMP-in-ICO wrapper for 16 and 32px
  const icoBuffer = createIco([
    { size: 16, data: favicon16Buf },
    { size: 32, data: favicon32Buf },
  ]);
  writeFileSync(join(PUBLIC, 'favicon.ico'), icoBuffer);
  console.log(`  Created ${join(PUBLIC, 'favicon.ico')}`);

  console.log('Done!');
}

/** Minimal ICO file builder from PNG buffers */
function createIco(images: { size: number; data: Buffer }[]): Buffer {
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * images.length;
  let offset = headerSize + dirSize;

  // ICO header
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);       // reserved
  header.writeUInt16LE(1, 2);       // type: ICO
  header.writeUInt16LE(images.length, 4);

  const dirEntries: Buffer[] = [];
  for (const img of images) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(img.size < 256 ? img.size : 0, 0);   // width
    entry.writeUInt8(img.size < 256 ? img.size : 0, 1);   // height
    entry.writeUInt8(0, 2);     // color palette
    entry.writeUInt8(0, 3);     // reserved
    entry.writeUInt16LE(1, 4);  // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.data.length, 8);  // size
    entry.writeUInt32LE(offset, 12);          // offset
    dirEntries.push(entry);
    offset += img.data.length;
  }

  return Buffer.concat([header, ...dirEntries, ...images.map((i) => i.data)]);
}

main().catch(console.error);
