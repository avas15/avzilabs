import type { APIContext } from 'astro';
import { SITE } from '@/config';

/*
  The apex is fully crawlable. The dynamic subdomains carry X-Robots-Tag:
  noindex via a Cloudflare Transform Rule rather than being listed here -
  robots.txt on this host has no authority over them.
*/
export function GET(context: APIContext) {
  const sitemapURL = new URL('sitemap-index.xml', context.site ?? SITE.url);

  const body = `User-agent: *
Allow: /

Sitemap: ${sitemapURL.href}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
