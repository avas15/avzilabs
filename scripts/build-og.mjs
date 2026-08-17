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

/*
  "AVZILABS" in Bedstead, the SAA5050 teletext face, pre-converted to outlines.
  Baked in as paths so the card renders identically without Bedstead needing to
  be installed on whatever machine runs the build - sharp resolves font-family
  against system fonts only, so referencing it by name would silently fall back.
  Public domain; provenance in public/fonts/README.md.
  Coordinates are a 1000-unit em, y-up, so the group flips and scales below.
*/
const WORDMARK_UPEM = 1000;
const WORDMARK_ADVANCE = 4800;
const WORDMARK_PATHS = `<path transform="translate(0 0)" d="M371 700H329L100 471V0H200V200H500V0H600V471ZM350 579 500 429V300H200V429Z"/><path transform="translate(600 0)" d="M200 700H100V429L200 329V229L300 129V0H400V129L500 229V329L600 429V700H500V471L400 371V271L350 221L300 271V371L200 471Z"/><path transform="translate(1200 0)" d="M100 600H500V571L100 171V0H600V100H200V129L600 529V700H100Z"/><path transform="translate(1800 0)" d="M200 600H300V100H200V0H500V100H400V600H500V700H200Z"/><path transform="translate(2400 0)" d="M200 700H100V0H600V100H200Z"/><path transform="translate(3000 0)" d="M371 700H329L100 471V0H200V200H500V0H600V471ZM350 579 500 429V300H200V429Z"/><path transform="translate(3600 0)" d="M100 700V0H471L600 129V271L521 350L600 429V571L471 700ZM200 600H429L500 529V471L429 400H200ZM200 300H429L500 229V171L429 100H200Z"/><path transform="translate(4200 0)" d="M229 700 100 571V429L229 300H429L500 229V171L429 100H271L171 200H100V129L229 0H471L600 129V271L471 400H271L200 471V529L271 600H429L529 500H600V571L471 700Z"/>`;

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

/*
  Teletext wordmark, double-height as Mode 7 headlines always were. Positions
  below are derived from its rendered height rather than hardcoded, because the
  2x vertical stretch makes it far taller than the nominal font size suggests
  and eyeballed offsets collide with the tagline.
*/
const WORDMARK_TOP = 178;
const WORDMARK_WIDTH = 520;
const wmScale = WORDMARK_WIDTH / WORDMARK_ADVANCE;
const wmHeight = WORDMARK_UPEM * wmScale * 2;
const wmBaseline = WORDMARK_TOP + wmHeight;

const WORDMARK_SVG =
  `<g transform="translate(92 ${wmBaseline}) scale(${wmScale} ${-wmScale * 2})" ` +
  `fill="${GREEN}">${WORDMARK_PATHS}</g>`;

const TAGLINE_Y = Math.round(wmBaseline + 58);

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

  ${WORDMARK_SVG}

  <text x="92" y="${TAGLINE_Y}" font-family="ui-monospace, monospace" font-size="34"
        font-weight="700" fill="#C8FFD4">spectrum auctions, games,</text>
  <text x="92" y="${TAGLINE_Y + 44}" font-family="ui-monospace, monospace" font-size="34"
        font-weight="700" fill="#C8FFD4">and tools worth using.<tspan fill="${GREEN}">_</tspan></text>

  <rect x="92" y="${TAGLINE_Y + 72}" width="420" height="2" fill="${DIM}" opacity="0.7"/>
  <text x="92" y="${TAGLINE_Y + 112}" font-family="ui-monospace, monospace" font-size="24"
        fill="${DIM}">avzilabs.com</text>
</svg>`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
console.log(`Wrote ${out}`);
