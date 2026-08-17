/**
 * Generates the default social card at public/og/default.png.
 *
 * Build-time script rather than a runtime endpoint so the site stays fully
 * static: no Pages Functions means the Workers request limit never applies.
 * Run with `npm run og` after changing the branding.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/og/default.png');

const W = 1200;
const H = 630;

const GREEN = '#00FF41';
const DIM = '#00A82D';

// Deterministic pseudo-random so the card is byte-identical between builds.
// Math.random would make every build a spurious diff.
let seed = 20260817;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const GLYPHS = 'アイウエオカキクケコサシスセソタチツ0123456789<>[]{}/\\|=+*#$%&@';

// Faint digital rain behind the text.
let rain = '';
for (let col = 0; col < 60; col++) {
  const x = col * 20 + 6;
  const len = 4 + Math.floor(rnd() * 16);
  const startY = Math.floor(rnd() * H);
  for (let i = 0; i < len; i++) {
    const y = startY + i * 20;
    if (y > H) break;
    const op = (0.05 + (i / len) * 0.16).toFixed(3);
    const ch = GLYPHS[Math.floor(rnd() * GLYPHS.length)];
    const safe = ch.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    rain += `<text x="${x}" y="${y}" font-family="monospace" font-size="17" fill="${GREEN}" opacity="${op}">${safe}</text>`;
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#000000"/>
  ${rain}

  <rect x="48" y="48" width="${W - 96}" height="${H - 96}" fill="none" stroke="${DIM}" stroke-width="2" opacity="0.55"/>
  <rect x="48" y="48" width="46" height="3" fill="${GREEN}"/>
  <rect x="48" y="48" width="3" height="46" fill="${GREEN}"/>
  <rect x="${W - 94}" y="${H - 51}" width="46" height="3" fill="${GREEN}"/>
  <rect x="${W - 51}" y="${H - 94}" width="3" height="46" fill="${GREEN}"/>

  <text x="92" y="132" font-family="ui-monospace, monospace" font-size="22"
        fill="${DIM}">avas@avzilabs:~$ whoami</text>

  <text x="92" y="256" font-family="ui-monospace, monospace" font-size="62"
        font-weight="700" fill="${GREEN}">spectrum auctions,</text>
  <text x="92" y="336" font-family="ui-monospace, monospace" font-size="62"
        font-weight="700" fill="${GREEN}">games, and tools</text>
  <text x="92" y="416" font-family="ui-monospace, monospace" font-size="62"
        font-weight="700" fill="#C8FFD4">worth using.<tspan fill="${GREEN}">_</tspan></text>

  <rect x="92" y="470" width="420" height="2" fill="${DIM}" opacity="0.7"/>
  <text x="92" y="522" font-family="ui-monospace, monospace" font-size="24"
        fill="${DIM}">avzilabs.com</text>
</svg>`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
console.log(`Wrote ${out}`);
