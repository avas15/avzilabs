# avzilabs.com

The public site: portfolio, writing, and the landing pages for the games and tools.

Built with Astro, output is fully static, deployed to Cloudflare Pages.

## Why static

The dynamic services (multiplayer games, file conversion, live application demos) run on a
separate small server. This site does not, and that is deliberate: a traffic spike on a game
cannot degrade the blog or the portfolio, because they are not on the same infrastructure.

Building with `output: 'static'` and no Pages Functions also keeps the deployment inside
Cloudflare's unmetered static asset serving rather than the Workers request allowance.

## Local development

```bash
npm install
npm run dev
```

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on :4321 |
| `npm run build` | Static build to `dist/` |
| `npm run preview` | Serve the built output |
| `npm run check` | Astro and TypeScript diagnostics |
| `npm run og` | Regenerate `public/og/default.png` |

## Adding content

Everything on the homepage is driven by content collections. Nothing is hard-coded.

**A project or game:** add an MDX file to `src/content/projects/`. The schema is in
`src/content.config.ts`.

**The storefront hero slot:** set `featured: true` on exactly one project. It takes the
featured release card on the homepage.

**A post:** add an MDX file to `src/content/blog/`. Set `draft: true` to keep it out of the
build; drafts still render in dev.

## Design system

Phosphor CRT terminal: green on black, monospace throughout, ASCII in place of icons where a
glyph will do. Implemented in `src/styles/global.css`.

Green at full saturation is punishing to read at length, so the palette splits it: soft
phosphor (`--text`, `#C8FFD4`) for body copy, full `#00FF41` reserved for headings, prompts and
accents. Both sit well above AA contrast on black.

- `mtx-*` is the green ramp, `void-*` the black substrate. Amber and red exist for warnings and
  errors, as a period terminal would have them.
- `.term` / `.term-bar` / `.term-corners` build the window chrome. `.tag`, `.prompt`, `.caret`
  and `.ascii` are the smaller primitives.
- A light theme is defined and works; it drops the CRT effects rather than inverting them.

Two effects are decorative and always non-interactive: `.crt-scanlines` and `.crt-vignette`,
both `pointer-events: none` and both disabled under reduced motion.

Motion lives in `src/scripts/motion.ts`. Three rules it enforces:

1. `prefers-reduced-motion` disables all of it.
2. Nothing is gated behind JavaScript. The `no-motion` class ships in the HTML and keeps every
   revealable element visible; it is only removed once motion is confirmed to be running.
3. It initialises after `load`, so it cannot delay LCP.

## Build state

`UNDER_DEVELOPMENT` in `src/config.ts` gates public visibility. While it is `true` a banner
renders site-wide, every page is `noindex, nofollow`, and `robots.txt` serves `Disallow: /`.

It is currently `false`. The site is live at https://avzilabs.com.

## Deployment

Live on Cloudflare Pages (project `avzilabs`), with `avzilabs.com` and `www` attached as custom
domains. Deploys are direct uploads of `dist/`:

```bash
npx wrangler pages deploy dist --project-name avzilabs --branch main
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 22 (Astro 7 requires >=22.12.0) |

Zone settings: TLS 1.2 minimum, TLS 1.3 on, Always Use HTTPS, SSL mode `strict` (valid because
the origin is Pages, which presents a real certificate).

CI runs gitleaks on every push. This repository is public, so that gate is not optional.
