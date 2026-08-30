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

      -- Words from published, permissively licensed sources. Kept in its own
      -- table rather than merged into community: "a dictionary says so" and
      -- "the table voted it in" are different claims, and conflating them
      -- would make the community list unauditable.
      CREATE TABLE IF NOT EXISTS official (
        category TEXT NOT NULL,
        word     TEXT NOT NULL,
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

    /*
      Batch validity check.

      This is the important endpoint. The alternative - shipping whole word
      lists to the room so it can build a Set - means moving 370,000 words per
      round for a game with at most 160 answers in it. Here the room sends the
      answers it actually needs to judge, and gets back only those that exist.
    */
    if (url.pathname.endsWith('/check') && request.method === 'POST') {
      const pairs = (await request.json()) as { category: string; word: string }[];
      if (!Array.isArray(pairs) || pairs.length === 0) return Response.json({ valid: [] });

      const valid: { category: string; word: string }[] = [];
      for (const { category, word } of pairs.slice(0, 400)) {
        if (!category || !word) continue;
        const hit = this.ctx.storage.sql
          .exec<{ n: number }>(
            `SELECT (
               (SELECT COUNT(*) FROM official  WHERE category = ?1 AND word = ?2) +
               (SELECT COUNT(*) FROM community WHERE category = ?1 AND word = ?2)
             ) AS n`,
            category,
            word
          )
          .one().n;
        if (hit > 0) valid.push({ category, word });
      }

      /*
        Also report which categories have an official list at all.

        Without this the caller cannot distinguish "this category has no
        dictionary" from "it has one and none of these answers were in it".
        Those must behave differently: the first accepts, the second rejects.
      */
      const covered = [
        ...new Set(
          this.ctx.storage.sql
            .exec<{ category: string }>('SELECT DISTINCT category FROM official')
            .toArray()
            .map((r) => r.category)
        ),
      ];
      return Response.json({ valid, covered });
    }

    /*
      Seed official words, in chunks.

      Chunked because the general English list alone is well over 300,000
      entries, and a single request large enough to carry it would exceed what
      one Durable Object invocation should be doing. The caller drives the
      loop; this is idempotent, so a retried chunk is harmless.
    */
    if (url.pathname.endsWith('/seed') && request.method === 'POST') {
      const body = (await request.json()) as { category: string; words: string[] };
      if (!body?.category || !Array.isArray(body.words)) {
        return Response.json({ ok: false, error: 'category and words required' }, { status: 400 });
      }
      let n = 0;
      for (const w of body.words) {
        const word = String(w).trim();
        if (!word) continue;
        this.ctx.storage.sql.exec(
          'INSERT INTO official (category, word) VALUES (?, ?) ON CONFLICT DO NOTHING',
          body.category,
          word
        );
        n++;
      }
      return Response.json({ ok: true, inserted: n });
    }

    // Which categories have an official list, and how big. Used to decide
    // whether a category is worth validating against at all.
    if (url.pathname.endsWith('/stats')) {
      const rows = this.ctx.storage.sql
        .exec<{ category: string; n: number }>(
          'SELECT category, COUNT(*) AS n FROM official GROUP BY category ORDER BY category'
        )
        .toArray();
      const community = this.ctx.storage.sql
        .exec<{ n: number }>('SELECT COUNT(*) AS n FROM community')
        .one().n;
      return Response.json({ official: rows, communityCount: community });
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
