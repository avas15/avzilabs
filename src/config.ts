/**
 * Single source of truth for site-wide metadata.
 * Used by astro.config.mjs, the SEO head, the RSS feed and the JSON-LD blocks.
 */

export const SITE = {
  url: 'https://avzilabs.com',
  name: 'Avzi Labs',
  title: 'Avzi Labs',
  tagline: 'Spectrum auctions, games, and tools that should not need an ad-blocker.',
  description:
    'Avzi builds spectrum-auction platforms, games and small useful tools. Live demos, writing on auction design, and a growing shelf of things worth playing with.',
  author: 'Avzi',
  locale: 'en_GB',
  lang: 'en-GB',
} as const;

/**
 * Site-wide build state. While this is true the site renders an "under
 * development" notice and every interactive surface is presented as not yet
 * open. No service origins are referenced anywhere until the backend exists.
 */
export const UNDER_DEVELOPMENT = false;

/**
 * Origin of the realtime game Worker. Overridable at build time so a local
 * `wrangler dev` can be pointed at during development.
 */
export const GAME_ORIGIN =
  import.meta.env.PUBLIC_GAME_ORIGIN ?? 'https://play.avzilabs.com';

export const SOCIAL = {
  github: 'https://github.com/avas15',
  email: 'hello@avzilabs.com',
} as const;

export const NAV = [
  { label: 'Work', href: '/projects' },
  { label: 'Stack', href: '/stack' },
  { label: 'Writing', href: '/blog' },
  { label: 'Play', href: '/play' },
  { label: 'Tools', href: '/tools' },
] as const;
