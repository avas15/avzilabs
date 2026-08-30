/**
 * Proves the official dictionary actually rejects what it should, against a
 * running server with the lists seeded.
 *
 *   node scripts/seed-dictionaries.mjs
 *   BASE=https://play.avzilabs.com node test/dictionary.mjs
 *
 * The cases come from a real game: "lasfo" and a bare "L" both scored ten
 * points on an L round, because the only check was "starts with the letter".
 */
const BASE = process.env.BASE ?? 'https://play.avzilabs.com';

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
};

const post = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

console.log('Cat Dog Fish dictionary\n');

// ------------------------------------------------------------------- coverage
const stats = await (await fetch(`${BASE}/api/dictionary/stats`)).json();
const byCat = Object.fromEntries((stats.official ?? []).map((r) => [r.category, r.n]));
console.log('  seeded:', JSON.stringify(byCat), '\n');

check('Animal list is seeded', (byCat['Animal'] ?? 0) > 100000, `${byCat['Animal']} words`);
check('name lists are seeded', (byCat['Boy name'] ?? 0) > 10000, `${byCat['Boy name']} names`);
check('Country list is seeded', (byCat['Country'] ?? 0) > 150, `${byCat['Country']}`);
check('Drink list is seeded', (byCat['Drink'] ?? 0) > 1000, `${byCat['Drink']}`);
check('Chocolate deliberately NOT seeded', byCat['Chocolate'] === undefined,
  'only 40 entries available, too thin to trust');
check('Film deliberately NOT seeded', byCat['Film'] === undefined,
  'no permissively licensed source with usable coverage');

// --------------------------------------------------------------- the failures
console.log('\n  the answers that were scored wrongly in a real game:');
const cases = [
  ['Animal', 'lasfo', false, 'gibberish that starts with the round letter'],
  ['Animal', 'lion', true, 'a real word'],
  ['Girl name', 'loretta', true, 'rejected by a plain word list, correct here'],
  ['Boy name', 'leon', true, 'ditto'],
  ['Drink', 'long island iced tea', true, 'multi-word, needs a real drinks list'],
  ['Drink', 'lamp', false, 'a real word, but not a drink'],
  ['Country', 'france', true, 'a country'],
  ['Country', 'lyon', false, 'a city, not a country'],
];

const { valid, covered } = await post('/api/dictionary/check',
  cases.map(([category, word]) => ({ category, word })));
const hit = new Set(valid.map((v) => `${v.category}::${v.word}`));

for (const [category, word, want, why] of cases) {
  const got = hit.has(`${category}::${word}`);
  check(`${JSON.stringify(word)} in ${category} -> ${got}`, got === want, why);
}

// ------------------------------------------------------------------- coverage
console.log('\n  coverage reporting:');
check('covered categories are reported', Array.isArray(covered) && covered.length > 0,
  (covered ?? []).join(', '));
check('an uncovered category is absent from covered',
  !(covered ?? []).includes('Film'),
  'so the room falls back to the letter rule for it');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
