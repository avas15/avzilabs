import { DurableObject } from 'cloudflare:workers';
import type { DictionaryEntry } from './types';

/**
 * The community dictionary: words the table voted back in after a protest.
 *
 * A single instance shared by every room, so a word won in one game is
 * recognised in the next. Held deliberately apart from any official word list:
 * this is what players collectively decided counts, which is not the same claim
 * as a dictionary makes, and the two should never be conflated when a future
 * official list is added alongside it.
 *
 * SQLite-backed, which is the only Durable Object storage on the free plan.
 */
export class Dictionary extends DurableObject {
  private ready = false;

  private init(): void {
    if (this.ready) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS community (
        category   TEXT NOT NULL,
        word       TEXT NOT NULL,
        added_by   TEXT NOT NULL,
        added_at   INTEGER NOT NULL,
        votes_for  INTEGER NOT NULL,
        votes_against INTEGER NOT NULL,
        PRIMARY KEY (category, word)
      );
    `);
    this.ready = true;
  }

  async fetch(request: Request): Promise<Response> {
    this.init();
    const url = new URL(request.url);

    // Every accepted word for a set of categories, for validation at scoring.
    if (url.pathname.endsWith('/lookup')) {
      const categories = (url.searchParams.get('categories') ?? '')
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      const out: Record<string, string[]> = {};
      for (const c of categories) {
        const rows = this.ctx.storage.sql
          .exec<{ word: string }>('SELECT word FROM community WHERE category = ?', c)
          .toArray();
        out[c] = rows.map((r) => r.word);
      }
      return Response.json(out);
    }

    if (url.pathname.endsWith('/add') && request.method === 'POST') {
      const e = (await request.json()) as DictionaryEntry;
      if (!e?.category || !e?.word) {
        return Response.json({ ok: false, error: 'category and word required' }, { status: 400 });
      }
      // Idempotent: the same word winning twice should not error or double up.
      this.ctx.storage.sql.exec(
        `INSERT INTO community (category, word, added_by, added_at, votes_for, votes_against)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (category, word) DO UPDATE SET
           votes_for = MAX(votes_for, excluded.votes_for),
           votes_against = MAX(votes_against, excluded.votes_against)`,
        e.category,
        e.word,
        e.addedBy ?? 'unknown',
        e.addedAt ?? Date.now(),
        e.votesFor ?? 0,
        e.votesAgainst ?? 0
      );
      return Response.json({ ok: true });
    }

    // Public listing, so the site can show what the community has voted in.
    if (url.pathname.endsWith('/list')) {
      const limit = Math.min(500, Number(url.searchParams.get('limit') ?? 200) || 200);
      const rows = this.ctx.storage.sql
        .exec<{
          category: string;
          word: string;
          addedBy: string;
          addedAt: number;
          votesFor: number;
          votesAgainst: number;
        }>(
          `SELECT category, word, added_by AS addedBy, added_at AS addedAt,
                  votes_for AS votesFor, votes_against AS votesAgainst
           FROM community ORDER BY added_at DESC LIMIT ?`,
          limit
        )
        .toArray();
      return Response.json({ entries: rows, count: rows.length });
    }

    return new Response('not found', { status: 404 });
  }
}
