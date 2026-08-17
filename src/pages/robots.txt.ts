import type { APIContext } from 'astro';
import { SITE, UNDER_DEVELOPMENT } from '@/config';

/*
  Crawling is closed while the site is under development, and opens with the
  same flag that removes the banner. Note that robots.txt here has no authority
  over any other host, so anything served elsewhere needs its own controls.
*/
export function GET(context: APIContext) {
  const sitemapURL = new URL('sitemap-index.xml', context.site ?? SITE.url);

  const body = UNDER_DEVELOPMENT
    ? `User-agent: *
Disallow: /
`
    : `User-agent: *
Allow: /

Sitemap: ${sitemapURL.href}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
