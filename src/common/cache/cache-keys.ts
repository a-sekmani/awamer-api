import { createHash } from 'node:crypto';

export type OwnerType = 'path' | 'course';

/**
 * Single source of truth for cache key construction.
 * No module should build cache keys via string concatenation — always use these helpers.
 */
export const CacheKeys = {
  tags: {
    all: () => 'tags:all',
    adminAll: () => 'tags:admin:all',
  },
  categories: {
    all: () => 'categories:all',
  },
  paths: {
    list: (queryHash: string) => `paths:list:${queryHash}`,
    detail: (slug: string) => `paths:detail:${slug}`,
    listPattern: () => 'paths:list:*',
    detailPattern: () => 'paths:detail:*',
  },
  courses: {
    list: (queryHash: string) => `courses:list:${queryHash}`,
    detail: (slug: string) => `courses:detail:${slug}`,
    listPattern: () => 'courses:list:*',
    detailPattern: () => 'courses:detail:*',
  },
  marketing: {
    features: (ownerType: OwnerType, ownerId: string) =>
      `marketing:features:${ownerType}:${ownerId}`,
    faqs: (ownerType: OwnerType, ownerId: string) =>
      `marketing:faqs:${ownerType}:${ownerId}`,
    testimonials: (ownerType: OwnerType, ownerId: string) =>
      `marketing:testimonials:${ownerType}:${ownerId}`,
  },
} as const;

/**
 * TTL policy in seconds. `null` means no expiry — the key is invalidated only on mutation.
 */
export const CacheTTL = {
  TAGS: null,
  CATEGORIES: null,
  LIST: 300,
  DETAIL: null,
  MARKETING: null,
} as const;

export type CacheTTLValue = (typeof CacheTTL)[keyof typeof CacheTTL];

/**
 * Produces a deterministic 16-character hex digest of the normalized query parameters.
 * Parameter order is irrelevant: keys are sorted alphabetically before hashing.
 */
export function buildQueryHash(params: Record<string, unknown>): string {
  const sortedKeys = Object.keys(params).sort();
  const normalized = sortedKeys.reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = params[k];
    return acc;
  }, {});
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 16);
}
