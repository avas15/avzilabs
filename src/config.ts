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
    'Avas Saeed builds spectrum-auction platforms, games and small useful tools. Live demos, writing on auction design, and a growing shelf of things worth playing with.',
  author: 'Avas Saeed',
  locale: 'en_GB',
  lang: 'en-GB',
} as const;

/**
 * Origins for the dynamic services. These live on the VPS behind Cloudflare
 * Tunnel and are noindex; only the landing pages on the apex are indexable.
 * Overridable at build time so a preview deploy can point somewhere else.
 */
export const ORIGINS = {
  api: import.meta.env.PUBLIC_API_ORIGIN ?? 'https://api.avzilabs.com',
  play: import.meta.env.PUBLIC_PLAY_ORIGIN ?? 'https://play.avzilabs.com',
  private: import.meta.env.PUBLIC_MY_ORIGIN ?? 'https://my.avzilabs.com',
} as const;

export const SOCIAL = {
  github: 'https://github.com/avas15',
  email: 'avas.saeed@gmail.com',
} as const;

export const NAV = [
  { label: 'Work', href: '/projects' },
  { label: 'Writing', href: '/blog' },
  { label: 'Play', href: '/play' },
  { label: 'Tools', href: '/tools' },
] as const;
