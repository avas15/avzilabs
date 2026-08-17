/**
 * End-to-end check against a running `wrangler dev`.
 *
 * The unit tests cover scoring in isolation; this drives the real Durable
 * Object over real WebSockets to prove the phase machine, the alarms, the
 * protest vote and the community dictionary all work together.
 *
 *   npx wrangler dev --port 8787
 *   node test/integration.mjs
 */
import WebSocket from 'ws';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');

let failures = 0;
const check = (label, cond, extra = '') => {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function player(name, code, create) {
  const ws = new WebSocket(`${WS}/ws?code=${code}&name=${name}${create ? '&create=1' : ''}`);
  const p = { name, ws, state: null, id: null, states: 0 };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'state') {
      p.state = msg.state;
      p.id = msg.you;
      p.states++;
    }
  });
  p.send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  p.ready = new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });
  return p;
}

/** Wait until predicate(p.state) or time out. */
async function until(p, pred, ms = 12000, label = '') {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (p.state && pred(p.state)) return true;
    await sleep(60);
  }
  console.log(`    (timed out waiting for ${label}; phase=${p.state?.phase})`);
  return false;
}

console.log('Cat Dog Fish integration\n');

// ---------------------------------------------------------------- room setup
const res = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
const { code } = await res.json();
check('allocates a room code', /^[A-Z0-9]{4}$/.test(code), code);

const host = player('Ana', code, true);
await host.ready;
const ben = player('Ben', code, false);
const cat = player('Cat', code, false);
await Promise.all([ben.ready, cat.ready]);
await sleep(400);

check('all three players are in the room', host.state?.players.length === 3);
check('first joiner is host', host.state?.hostId === host.id);

// A duplicate name should be disambiguated, not rejected.
const ben2 = player('Ben', code, false);
await ben2.ready;
await sleep(300);
const names = host.state.players.map((p) => p.name);
check('duplicate names are made unique', new Set(names).size === names.length, names.join(','));
ben2.ws.close();
await sleep(300);

// ------------------------------------------------------------------- a round
host.send({
  type: 'settings',
  settings: {
    categories: ['Animal', 'Food'],
    rounds: 2,
    roundSeconds: 6,
    graceSeconds: 0,
    penaltyInvalid: 0,
  },
});
await sleep(300);
check('host settings applied', host.state.settings.categories.join() === 'Animal,Food');

host.send({ type: 'start' });
check('enters the spin phase', await until(host, (s) => s.phase === 'spinning', 5000, 'spinning'));
const letter = host.state.letter;
check('a letter was chosen from the pool', host.state.settings.letterPool.includes(letter), letter);

check('spin advances to writing', await until(host, (s) => s.phase === 'writing', 8000, 'writing'));

// Everyone answers. Ana and Ben collide on Animal; Cat writes a wrong letter.
const L = letter;
host.send({ type: 'answer', category: 'Animal', value: `${L}ardvark` });
host.send({ type: 'answer', category: 'Food', value: `${L}pple` });
ben.send({ type: 'answer', category: 'Animal', value: `${L}ardvark` });
ben.send({ type: 'answer', category: 'Food', value: `${L}read` });
// Deliberately wrong first letter, so it can be protested.
cat.send({ type: 'answer', category: 'Animal', value: 'Zebra' });
cat.send({ type: 'answer', category: 'Food', value: `${L}heese` });
await sleep(600);

// Nobody may see anyone else's answers mid-round.
const leaked = Object.keys(ben.state.answers).filter((id) => id !== ben.id);
check('answers are hidden from other players while writing', leaked.length === 0, leaked.join());

host.send({ type: 'submit' });
ben.send({ type: 'submit' });
cat.send({ type: 'submit' });

check('all submitting ends the round', await until(host, (s) => s.phase === 'review', 8000, 'review'));

const r1 = host.state.results.at(-1);
check('duplicate answers score 5 each',
  r1.breakdown[host.id].Animal.points === 5 && r1.breakdown[ben.id].Animal.points === 5);
check('unique answers score 10', r1.breakdown[ben.id].Food.points === 10);
check('wrong-letter answer is marked invalid', r1.breakdown[cat.id].Animal.verdict === 'invalid');
check('answers are revealed at review', Object.keys(host.state.answers).length === 3);

// -------------------------------------------------------------- the protest
cat.send({ type: 'protest', category: 'Animal' });
check('protest opens a vote', await until(cat, (s) => !!s.protest, 5000, 'protest'));

// The author must not be able to vote for themselves.
cat.send({ type: 'vote', agree: true });
await sleep(250);
check('author cannot vote on their own answer', !(cat.id in (cat.state.protest?.votes ?? {})));

// 2 of 2 in favour is unanimous among votes cast, so it should be upheld.
host.send({ type: 'vote', agree: true });
ben.send({ type: 'vote', agree: true });
check('vote resolves once everyone eligible has voted',
  await until(cat, (s) => s.protest?.outcome != null, 6000, 'outcome'));
check('unanimous protest is upheld', cat.state.protest.outcome === 'upheld',
  `share=${cat.state.protest.agreeShare}`);

const r1b = cat.state.results.at(-1);
check('reinstated answer now scores', r1b.breakdown[cat.id].Animal.points > 0,
  `verdict=${r1b.breakdown[cat.id].Animal.verdict}`);
check('scores were recomputed, not patched',
  cat.state.players.find((p) => p.id === cat.id).score === r1b.totals[cat.id]);

// The word should now be in the shared community dictionary.
const dict = await (await fetch(`${BASE}/api/dictionary`)).json();
check('upheld word is written to the community dictionary',
  dict.entries?.some((e) => e.word === 'zebra' && e.category === 'Animal'),
  `${dict.count} entries`);

// -------------------------------------------------------- round 2 and finish
host.send({ type: 'next' });
check('review advances to results', await until(host, (s) => s.phase === 'results', 5000, 'results'));

host.send({ type: 'next' });
check('starts round 2', await until(host, (s) => s.round === 2 && s.phase !== 'results', 8000, 'round 2'));
check('the same letter is not reused',
  host.state.usedLetters.length === new Set(host.state.usedLetters).size,
  host.state.usedLetters.join(','));

// Let the round timer expire on its own rather than submitting.
check('the round timer ends the round unaided',
  await until(host, (s) => s.phase === 'review' && s.round === 2, 20000, 'timed round end'));

host.send({ type: 'next' });
await until(host, (s) => s.phase === 'results', 5000);
host.send({ type: 'next' });
check('game finishes after the last round',
  await until(host, (s) => s.phase === 'finished', 6000, 'finished'));

// ----------------------------------------------------------------- teardown
for (const p of [host, ben, cat]) p.ws.close();
await sleep(400);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
