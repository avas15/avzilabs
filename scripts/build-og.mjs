/**
 * Generates the default social card at public/og/default.png.
 *
 * Kept as a build-time script rather than a runtime endpoint so the site stays
 * fully static: no Pages Functions means the Workers request limit never
 * applies. Run with `npm run og` after changing the branding.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/og/default.png');

const W = 1200;
const H = 630;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#9A4A18"/>
      <stop offset="40%" stop-color="#C45F20"/>
      <stop offset="100%" stop-color="#703510"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.75">
      <stop offset="0%" stop-color="#FA8334" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#FA8334" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#010A14"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect width="${W}" height="6" fill="url(#brand)"/>

  <rect x="72" y="86" width="64" height="64" rx="14" fill="url(#brand)"/>
  <text x="104" y="130" font-family="Inter, Segoe UI, sans-serif" font-size="34"
        font-weight="800" fill="#ffffff" text-anchor="middle">A</text>
  <text x="156" y="129" font-family="Inter, Segoe UI, sans-serif" font-size="27"
        font-weight="600" fill="#ffffff" letter-spacing="-0.5">Avzi Labs</text>

  <text x="72" y="300" font-family="Inter, Segoe UI, sans-serif" font-size="70"
        font-weight="800" fill="#ffffff" letter-spacing="-2.4">Spectrum auctions,</text>
  <text x="72" y="382" font-family="Inter, Segoe UI, sans-serif" font-size="70"
        font-weight="800" fill="#ffffff" letter-spacing="-2.4">games, and tools</text>
  <text x="72" y="464" font-family="Inter, Segoe UI, sans-serif" font-size="70"
        font-weight="800" fill="#FA8334" letter-spacing="-2.4">worth using.</text>

  <rect x="72" y="524" width="440" height="2" fill="url(#brand)"/>
  <text x="72" y="572" font-family="Inter, Segoe UI, sans-serif" font-size="24"
        font-weight="500" fill="#8FA3B5">avzilabs.com</text>
</svg>`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
console.log(`Wrote ${out}`);
