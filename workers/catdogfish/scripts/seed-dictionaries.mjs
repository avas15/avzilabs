/**
 * Push the generated word lists into the Dictionary Durable Object.
 *
 * Run once after `build-dictionaries.py`, and again whenever the lists change.
 * Seeding is idempotent, so a re-run or a retried chunk is harmless.
 *
 *   node scripts/seed-dictionaries.mjs                    # production
 *   BASE=http://127.0.0.1:8787 node scripts/seed-dictionaries.mjs
 *
 * Chunked deliberately: the general English list is over 300,000 entries, and
 * one request large enough to carry it is not something a single Durable Object
 * invocation should be attempting.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE = process.env.BASE ?? 'https://play.avzilabs.com';
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, '..', 'src', 'dictionaries.json');
const CHUNK = Number(process.env.CHUNK ?? 4000);

/**
 * Categories to actually seed.
 *
 * Chocolate is generated but deliberately not seeded: 40 entries is thin
 * enough that it would reject reasonable answers, and a dictionary that says
 * no to a real chocolate is worse than none. Film has no source at all. Both
 * fall back to the letter rule plus the protest vote.
 */
const SKIP = new Set(['Chocolate']);

const dicts = JSON.parse(readFileSync(DATA, 'utf8'));

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

let seeded = 0;
for (const [category, words] of Object.entries(dicts)) {
  if (SKIP.has(category)) {
    console.log(`  ${category.padEnd(12)} skipped (${words.length} available, too thin to trust)`);
    continue;
  }
  let done = 0;
  for (let i = 0; i < words.length; i += CHUNK) {
    const slice = words.slice(i, i + CHUNK);
    await post('/api/dictionary/seed', { category, words: slice });
    done += slice.length;
    if (words.length > CHUNK) {
      process.stdout.write(`\r  ${category.padEnd(12)} ${done}/${words.length}`);
    }
  }
  seeded += done;
  process.stdout.write(`\r  ${category.padEnd(12)} ${done} seeded\n`);
}

const stats = await (await fetch(`${BASE}/api/dictionary/stats`)).json();
console.log(`\n  total pushed: ${seeded}`);
console.log('  server reports:');
for (const row of stats.official ?? []) {
  console.log(`    ${row.category.padEnd(12)} ${row.n}`);
}
console.log(`    community    ${stats.communityCount ?? 0}`);
