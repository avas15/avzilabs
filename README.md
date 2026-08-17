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

Palette, typography and density come from the auction platform's `STYLE_TOKENS.md` and are
implemented in `src/styles/global.css`. Do not introduce colours outside the four ramps
(pumpkin, prussian, deepspace, berry).

Motion lives in `src/scripts/motion.ts`. Three rules it enforces:

1. `prefers-reduced-motion` disables all of it.
2. Nothing is gated behind JavaScript. The `no-motion` class ships in the HTML and keeps every
   revealable element visible; it is only removed once motion is confirmed to be running.
3. It initialises after `load`, so it cannot delay LCP.

## Build state

`UNDER_DEVELOPMENT` in `src/config.ts` gates going public. While it is `true`:

- an "under development" banner renders site-wide,
- every page is `noindex, nofollow`,
- `robots.txt` serves `Disallow: /`,
- no service origin is referenced anywhere, and nothing links to a running backend.

Setting it to `false` reverses all four. That is the switch for going live.

## Deployment

Connected to Cloudflare Pages via the native Git integration, which does not consume GitHub
Actions minutes.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 22 (Astro 7 requires >=22.12.0) |

CI runs gitleaks on every push. This repository is public, so that gate is not optional.
