import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Adding a project or a game release is adding one MDX file. Nothing in the
 * homepage or the hero card is hard-coded, which is the whole point.
 */

const linkSchema = z.object({
  label: z.string(),
  href: z.string(),
  /** Primary renders as the filled brand button. One per project at most. */
  primary: z.boolean().default(false),
  /** Marks a link that needs a login, so the UI can show the lock affordance. */
  gated: z.boolean().default(false),
});

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(120),
      description: z.string().max(300),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      draft: z.boolean().default(false),
    }),
});

const projects = defineCollection({
  loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(120),
      /** One line, used on cards and in search results. */
      summary: z.string().max(240),
      description: z.string().max(300).optional(),
      kind: z.enum(['game', 'webapp', 'data', 'tool', 'platform']),
      year: z.number().int().min(2000).max(2100),
      status: z.enum(['live', 'in-development', 'prototype', 'archived', 'case-study']),
      stack: z.array(z.string()).default([]),
      links: z.array(linkSchema).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      /** Short looping clip for the hero card. Served from R2, not committed. */
      heroVideo: z.string().url().optional(),
      heroPoster: image().optional(),
      /**
       * Exactly one project should carry `featured: true`. It takes the
       * storefront hero slot on the homepage.
       */
      featured: z.boolean().default(false),
      /** Genre chips on the hero card, storefront style. */
      genres: z.array(z.string()).default([]),
      /** Lower sorts first within the grid. */
      order: z.number().default(100),
      draft: z.boolean().default(false),
    }),
});

export const collections = { blog, projects };
