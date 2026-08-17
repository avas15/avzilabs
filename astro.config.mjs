// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import tailwindcss from '@tailwindcss/vite';

import { SITE } from './src/config.ts';

// Fully static output. This is deliberate: with no Pages Functions the
// Cloudflare Workers 100k-requests/day limit never applies, and static asset
// serving stays unmetered on the free plan.
export default defineConfig({
  site: SITE.url,
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  integrations: [
    mdx(),
    icon({
      include: {
        // Only the icons actually used get bundled.
        lucide: [
          'arrow-right',
          'arrow-up-right',
          'gamepad-2',
          'github',
          'linkedin',
          'mail',
          'menu',
          'x',
          'chart-no-axes-column',
          'wrench',
          'file-text',
          'play',
          'lock',
          'radio-tower',
          'external-link',
          'rss',
        ],
      },
    }),
    sitemap({
      filter: (page) => !page.includes('/draft/'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
