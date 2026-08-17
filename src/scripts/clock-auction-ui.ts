/**
 * UI for the clock auction demo.
 *
 * Deliberately thin: the engine in src/lib/clock-auction.ts runs the whole
 * auction up front and returns every round. This file only steps through the
 * result and draws it. Nothing here decides anything about the auction, which
 * is why the engine can be tested without a browser.
 */
import {
  demoConfig,
  runAuction,
  type AuctionConfig,
  type AuctionResult,
} from '@/lib/clock-auction';

export function mountClockAuction(root: HTMLElement): void {
  let config: AuctionConfig = demoConfig(7);
  let result: AuctionResult = runAuction(config);
  let cursor = 0;
  let playing = 0;

  const money = (n: number) =>
    n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

  const esc = (s: string) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  const nameOf = (id: string) => config.bidders.find((b) => b.id === id)?.name ?? id;

  function rerun(seed?: number) {
    if (seed !== undefined) config = demoConfig(seed);
    result = runAuction(config);
    cursor = 0;
    render();
  }

  // ------------------------------------------------------------------ views

  function controls(): string {
    const c = config;
    const numeric = (key: string, label: string, val: number, min: number, max: number, step = 1) => `
      <label class="block">
        <span class="text-[11px] uppercase tracking-wider text-ink-3">${label}</span>
        <input type="number" data-cfg="${key}" value="${val}" min="${min}" max="${max}" step="${step}"
          class="mt-1 w-full border border-line bg-bg-subtle px-2 py-1.5 text-[13px] text-ink tnum outline-none focus:border-brand" />
      </label>`;

    return `
      <div class="term term-corners">
        <div class="term-bar"><span>rules</span></div>
        <div class="p-4">
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            ${numeric('increment', 'increment', Math.round(c.increment * 100), 1, 50)}
            ${numeric('smallIncrement', 'late increment', Math.round(c.smallIncrement * 100), 1, 50)}
            ${numeric('smallIncrementFrom', 'slows at round', c.smallIncrementFrom, 1, 40)}
            ${numeric('activityRule', 'activity rule %', Math.round(c.activityRule * 100), 0, 100, 5)}
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <button data-act="apply" class="border border-brand bg-brand px-4 py-1.5 text-[13px] font-700 text-on-brand hover:bg-transparent hover:text-brand">[ rerun ]</button>
            <button data-act="reseed" class="border border-line-strong px-4 py-1.5 text-[13px] text-ink-2 hover:border-brand hover:text-brand">new bidders</button>
            <button data-act="reset" class="border border-line-strong px-4 py-1.5 text-[13px] text-ink-2 hover:border-brand hover:text-brand">reset rules</button>
          </div>
        </div>
      </div>`;
  }

  function transport(): string {
    const last = result.rounds.length - 1;
    const r = result.rounds[cursor];
    return `
      <div class="term term-corners">
        <div class="term-bar">
          <span class="text-brand">&#9654;</span>
          <span>round ${r.number} of ${result.rounds.length}</span>
          <span class="ml-auto ${result.hitRoundCap ? 'text-warn' : 'text-ok'}">
            ${result.hitRoundCap ? 'HIT ROUND CAP' : cursor === last ? 'CLEARED' : 'RUNNING'}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2 p-4">
          <button data-act="first" class="border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:border-brand hover:text-brand">|&lt;</button>
          <button data-act="prev" class="border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:border-brand hover:text-brand">&lt;</button>
          <button data-act="play" class="border border-brand px-4 py-1.5 text-[13px] text-brand hover:bg-brand hover:text-on-brand">${playing ? 'pause' : 'play'}</button>
          <button data-act="next" class="border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:border-brand hover:text-brand">&gt;</button>
          <button data-act="last" class="border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:border-brand hover:text-brand">&gt;|</button>
          <input type="range" data-act="scrub" min="0" max="${last}" value="${cursor}"
                 class="ml-2 min-w-[8rem] flex-1 accent-[var(--brand)]" aria-label="Round" />
        </div>
      </div>`;
  }

  /** Price path as an inline SVG. No chart library for four series. */
  function priceChart(): string {
    const W = 640;
    const H = 200;
    const pad = { l: 46, r: 10, t: 10, b: 22 };
    const rounds = result.rounds;
    const maxP = Math.max(
      ...rounds.flatMap((r) => Object.values(r.prices)),
      1
    );
    const x = (i: number) =>
      pad.l + (i / Math.max(rounds.length - 1, 1)) * (W - pad.l - pad.r);
    const y = (v: number) => H - pad.b - (v / maxP) * (H - pad.t - pad.b);

    const colours = ['#00FF41', '#00E5FF', '#FFB000', '#FF2E4D'];

    const series = config.products
      .map((p, i) => {
        const pts = rounds.map((r, idx) => `${x(idx)},${y(r.prices[p.id])}`).join(' ');
        const upTo = rounds
          .slice(0, cursor + 1)
          .map((r, idx) => `${x(idx)},${y(r.prices[p.id])}`)
          .join(' ');
        return `
          <polyline points="${pts}" fill="none" stroke="${colours[i % 4]}" stroke-width="1" opacity="0.22"/>
          <polyline points="${upTo}" fill="none" stroke="${colours[i % 4]}" stroke-width="2"/>
          <circle cx="${x(cursor)}" cy="${y(rounds[cursor].prices[p.id])}" r="3.5" fill="${colours[i % 4]}"/>`;
      })
      .join('');

    const legend = config.products
      .map(
        (p, i) =>
          `<span class="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
             <span style="width:10px;height:2px;background:${colours[i % 4]};display:inline-block"></span>
             ${esc(p.label)}
           </span>`
      )
      .join('');

    return `
      <div class="term term-corners">
        <div class="term-bar"><span>clock price path</span></div>
        <div class="p-4">
          <svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="Clock prices by round">
            <line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="var(--border)"/>
            <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}" stroke="var(--border)"/>
            <text x="4" y="${y(maxP) + 4}" fill="var(--text-3)" font-size="10">${Math.round(maxP)}</text>
            <text x="4" y="${H - pad.b + 4}" fill="var(--text-3)" font-size="10">0</text>
            <line x1="${x(cursor)}" y1="${pad.t}" x2="${x(cursor)}" y2="${H - pad.b}" stroke="var(--border-strong)" stroke-dasharray="2 3"/>
            ${series}
          </svg>
          <div class="mt-2 flex flex-wrap gap-3">${legend}</div>
        </div>
      </div>`;
  }

  function demandTable(): string {
    const r = result.rounds[cursor];
    const head = config.products
      .map((p) => `<th class="p-2 text-right text-[11px] uppercase tracking-wider text-ink-3">${esc(p.airport)}<br/>${esc(p.window)}</th>`)
      .join('');

    const rows = r.demands
      .map((d) => {
        const cells = config.products
          .map((p) => `<td class="p-2 text-right tnum text-ink">${d.demand[p.id]}</td>`)
          .join('');
        const strategy = config.bidders.find((b) => b.id === d.bidderId)?.strategy ?? '';
        return `
          <tr class="border-t border-line">
            <td class="p-2">
              <div class="text-ink">${esc(nameOf(d.bidderId))}</div>
              <div class="text-[11px] text-ink-3">${esc(strategy)}</div>
            </td>
            ${cells}
            <td class="p-2 text-right tnum ${d.lostEligibility > 0 ? 'text-[var(--danger)]' : 'text-ink-2'}">
              ${d.eligibilityAfter}${d.lostEligibility > 0 ? ` <span class="text-[11px]">(-${d.lostEligibility})</span>` : ''}
            </td>
          </tr>`;
      })
      .join('');

    const supplyRow = config.products
      .map((p) => `<td class="p-2 text-right tnum text-ink-3">${p.supply}</td>`)
      .join('');
    const demandRow = config.products
      .map((p) => {
        const ex = r.excess[p.id];
        const tone = ex > 0 ? 'text-warn' : ex < 0 ? 'text-info' : 'text-ok';
        return `<td class="p-2 text-right tnum ${tone}">${r.aggregate[p.id]}</td>`;
      })
      .join('');
    const priceRow = config.products
      .map((p) => `<td class="p-2 text-right tnum text-brand">${money(r.prices[p.id])}</td>`)
      .join('');

    return `
      <div class="term term-corners overflow-x-auto">
        <div class="term-bar">
          <span>round ${r.number} demand</span>
          <span class="ml-auto">${r.rising.length ? `${r.rising.length} product(s) rising` : 'all clear'}</span>
        </div>
        <table class="w-full min-w-[34rem] text-[13px]">
          <thead>
            <tr><th class="p-2 text-left text-[11px] uppercase tracking-wider text-ink-3">bidder</th>${head}
              <th class="p-2 text-right text-[11px] uppercase tracking-wider text-ink-3">elig.</th></tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="border-t-2 border-line-strong">
              <td class="p-2 text-[11px] uppercase tracking-wider text-ink-3">clock price</td>${priceRow}<td></td>
            </tr>
            <tr class="border-t border-line">
              <td class="p-2 text-[11px] uppercase tracking-wider text-ink-3">total demand</td>${demandRow}<td></td>
            </tr>
            <tr class="border-t border-line">
              <td class="p-2 text-[11px] uppercase tracking-wider text-ink-3">supply</td>${supplyRow}<td></td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  function outcome(): string {
    // Only meaningful once the auction has been stepped to the end.
    const atEnd = cursor === result.rounds.length - 1;
    const eff = Math.round(result.efficiency * 1000) / 10;

    const winners = result.assignments
      .map(
        (a) => `
        <tr class="border-t border-line">
          <td class="p-2 text-ink">${esc(nameOf(a.bidderId))}</td>
          <td class="p-2 text-ink-2">${esc(config.products.find((p) => p.id === a.productId)?.label ?? a.productId)}</td>
          <td class="p-2 text-right tnum text-ink">${a.slots}</td>
          <td class="p-2 text-right tnum text-ink-2">${money(a.pricePerSlot)}</td>
          <td class="p-2 text-right tnum text-brand">${money(a.cost)}</td>
        </tr>`
      )
      .join('');

    return `
      <div class="term term-corners ${atEnd ? '' : 'opacity-60'}">
        <div class="term-bar">
          <span>outcome</span>
          ${atEnd ? '' : '<span class="ml-auto text-ink-3">step to the end to see this settle</span>'}
        </div>
        <div class="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          <div class="bg-bg p-3"><div class="text-lg font-700 tnum text-brand">${money(result.revenue)}</div><div class="text-[11px] text-ink-3">revenue</div></div>
          <div class="bg-bg p-3"><div class="text-lg font-700 tnum text-ink">${eff}%</div><div class="text-[11px] text-ink-3">efficiency</div></div>
          <div class="bg-bg p-3"><div class="text-lg font-700 tnum text-ink">${result.rounds.length}</div><div class="text-[11px] text-ink-3">rounds</div></div>
          <div class="bg-bg p-3"><div class="text-lg font-700 tnum ${result.unsoldSlots ? 'text-warn' : 'text-ink'}">${result.unsoldSlots}</div><div class="text-[11px] text-ink-3">unsold slots</div></div>
        </div>
        <table class="w-full text-[13px]">
          <thead><tr class="text-[11px] uppercase tracking-wider text-ink-3">
            <th class="p-2 text-left">winner</th><th class="p-2 text-left">product</th>
            <th class="p-2 text-right">slots</th><th class="p-2 text-right">price</th><th class="p-2 text-right">cost</th>
          </tr></thead>
          <tbody>${winners || '<tr><td class="p-3 text-ink-3" colspan="5">nothing sold</td></tr>'}</tbody>
        </table>
        <p class="border-t border-line p-3 text-[12px] leading-relaxed text-ink-3">
          Efficiency compares the value actually realised against the best possible assignment
          ignoring price. Below 100% means slots ended up with someone who valued them less,
          which is what demand reduction and binding budgets cause.
        </p>
      </div>`;
  }

  // ----------------------------------------------------------------- render

  function render() {
    root.innerHTML = `
      <div class="space-y-5">
        ${controls()}
        ${transport()}
        <div class="grid gap-5 lg:grid-cols-2">${priceChart()}${outcome()}</div>
        ${demandTable()}
      </div>`;
    wire();
  }

  function step(to: number) {
    cursor = Math.max(0, Math.min(result.rounds.length - 1, to));
    render();
  }

  function wire() {
    const on = (sel: string, fn: (el: HTMLElement) => void) =>
      root.querySelectorAll<HTMLElement>(sel).forEach((el) =>
        el.addEventListener('click', () => fn(el))
      );

    on('[data-act="first"]', () => step(0));
    on('[data-act="prev"]', () => step(cursor - 1));
    on('[data-act="next"]', () => step(cursor + 1));
    on('[data-act="last"]', () => step(result.rounds.length - 1));

    on('[data-act="play"]', () => {
      if (playing) {
        clearInterval(playing);
        playing = 0;
        render();
        return;
      }
      if (cursor === result.rounds.length - 1) cursor = 0;
      playing = window.setInterval(() => {
        if (cursor >= result.rounds.length - 1) {
          clearInterval(playing);
          playing = 0;
          render();
          return;
        }
        step(cursor + 1);
      }, 700);
      render();
    });

    root.querySelector<HTMLInputElement>('[data-act="scrub"]')?.addEventListener('input', (e) => {
      step(Number((e.target as HTMLInputElement).value));
    });

    on('[data-act="apply"]', () => {
      const read = (k: string) =>
        Number(root.querySelector<HTMLInputElement>(`[data-cfg="${k}"]`)?.value);
      config = {
        ...config,
        increment: Math.max(0.01, read('increment') / 100),
        smallIncrement: Math.max(0.01, read('smallIncrement') / 100),
        smallIncrementFrom: Math.max(1, read('smallIncrementFrom')),
        activityRule: Math.min(1, Math.max(0, read('activityRule') / 100)),
      };
      rerun();
    });

    on('[data-act="reseed"]', () => rerun(Math.floor(Math.random() * 100000)));
    on('[data-act="reset"]', () => rerun(7));
  }

  render();
}
