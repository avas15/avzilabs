export { Room } from './room';
export { Dictionary } from './dictionary';

export interface Env {
  ROOM: DurableObjectNamespace;
  DICTIONARY: DurableObjectNamespace;
  /** Comma-separated list of allowed browser origins. */
  ALLOWED_ORIGINS?: string;
}

/** Unambiguous alphabet: no I/O/0/1, which people mistype off a screen share. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(len = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = (env.ALLOWED_ORIGINS ?? 'https://avzilabs.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = origin && (allowed.includes(origin) || allowed.includes('*'));
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] ?? '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // POST /api/rooms -> allocate a fresh, unused room code.
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = makeCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const res = await stub.fetch(new Request(`https://room/exists`));
        const { exists } = (await res.json()) as { exists: boolean };
        if (!exists) {
          return Response.json({ code }, { headers: cors });
        }
      }
      return Response.json({ error: 'could not allocate a code' }, { status: 503, headers: cors });
    }

    // GET /api/rooms/:code -> does it exist, and how full is it.
    const info = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{4,8})$/);
    if (info && request.method === 'GET') {
      const code = info[1].toUpperCase();
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      const res = await stub.fetch(new Request('https://room/exists'));
      const body = await res.json();
      return Response.json(body, { headers: cors });
    }

    // GET /ws?code=ABCD&name=... -> upgrade into the room's Durable Object.
    if (url.pathname === '/ws') {
      const code = (url.searchParams.get('code') ?? '').toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) {
        return new Response('bad room code', { status: 400, headers: cors });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      const forward = new URL(request.url);
      forward.searchParams.set('code', code);
      return stub.fetch(new Request(forward.toString(), request));
    }

    // Seed and inspect the official lists. Seeding is idempotent.
    if (url.pathname.startsWith('/api/dictionary/') && url.pathname !== '/api/dictionary') {
      const tail = url.pathname.slice('/api/dictionary/'.length);
      if (!['seed', 'stats', 'check'].includes(tail)) {
        return new Response('not found', { status: 404, headers: cors });
      }
      const stub = env.DICTIONARY.get(env.DICTIONARY.idFromName('global'));
      const res = await stub.fetch(`https://dict/${tail}`, {
        method: request.method,
        headers: { 'content-type': 'application/json' },
        body: request.method === 'POST' ? await request.text() : undefined,
      });
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'content-type': 'application/json' },
      });
    }

    // Words the table has voted in. Public, so the site can show them.
    if (url.pathname === '/api/dictionary' && request.method === 'GET') {
      const stub = env.DICTIONARY.get(env.DICTIONARY.idFromName('global'));
      const limit = url.searchParams.get('limit') ?? '200';
      const res = await stub.fetch(`https://dict/list?limit=${encodeURIComponent(limit)}`);
      return new Response(res.body, {
        status: res.status,
        headers: { ...cors, 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true }, { headers: cors });
    }

    return new Response('not found', { status: 404, headers: cors });
  },
};
