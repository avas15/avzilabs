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
 * Site-wide build state. While this is true the site renders an "under
 * development" notice and every interactive surface is presented as not yet
 * open. No service origins are referenced anywhere until the backend exists.
 */
export const UNDER_DEVELOPMENT = false;

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
