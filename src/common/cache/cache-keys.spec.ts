import { buildQueryHash, CacheKeys, CacheTTL } from './cache-keys';

const KEY_GRAMMAR = /^[a-z0-9:-]+$/;

describe('CacheKeys', () => {
  it('produces the expected literal keys for tags', () => {
    expect(CacheKeys.tags.all()).toBe('tags:all');
    expect(CacheKeys.tags.adminAll()).toBe('tags:admin:all');
  });

  it('produces the expected literal key for categories', () => {
    expect(CacheKeys.categories.all()).toBe('categories:all');
  });

  it('produces paths keys with slug or query hash', () => {
    expect(CacheKeys.paths.list('abc1234567890def')).toBe(
      'paths:list:abc1234567890def',
    );
    expect(CacheKeys.paths.detail('my-path-slug')).toBe(
      'paths:detail:my-path-slug',
    );
  });

  it('produces courses keys with slug or query hash', () => {
    expect(CacheKeys.courses.list('hash1234567890ab')).toBe(
      'courses:list:hash1234567890ab',
    );
    expect(CacheKeys.courses.detail('my-course-slug')).toBe(
      'courses:detail:my-course-slug',
    );
  });

  it('produces marketing keys with lowercase owner type and uuid', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(CacheKeys.marketing.features('path', id)).toBe(
      `marketing:features:path:${id}`,
    );
    expect(CacheKeys.marketing.faqs('course', id)).toBe(
      `marketing:faqs:course:${id}`,
    );
    expect(CacheKeys.marketing.testimonials('path', id)).toBe(
      `marketing:testimonials:path:${id}`,
    );
  });

  it('produces only grammar-conformant keys (lowercase, [a-z0-9:-])', () => {
    const samples = [
      CacheKeys.tags.all(),
      CacheKeys.tags.adminAll(),
      CacheKeys.categories.all(),
      CacheKeys.paths.list('abc1234567890def'),
      CacheKeys.paths.detail('slug-with-dashes'),
      CacheKeys.courses.list('abc1234567890def'),
      CacheKeys.courses.detail('slug-with-dashes'),
      CacheKeys.marketing.features(
        'path',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ),
    ];
    for (const key of samples) {
      expect(key).toMatch(KEY_GRAMMAR);
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('is deterministic — identical inputs produce identical output', () => {
    expect(CacheKeys.paths.detail('x')).toBe(CacheKeys.paths.detail('x'));
    expect(CacheKeys.marketing.faqs('course', 'id')).toBe(
      CacheKeys.marketing.faqs('course', 'id'),
    );
  });
});

describe('buildQueryHash', () => {
  it('returns a 16-character lowercase hex string', () => {
    const hash = buildQueryHash({ a: 1, b: 2 });
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
    expect(hash).toHaveLength(16);
  });

  it('is order-independent', () => {
    expect(buildQueryHash({ a: 1, b: 2 })).toBe(buildQueryHash({ b: 2, a: 1 }));
  });

  it('produces different hashes for different content', () => {
    expect(buildQueryHash({ a: 1 })).not.toBe(buildQueryHash({ a: 2 }));
  });

  it('is deterministic across invocations', () => {
    const params = { page: 1, limit: 20, sort: 'created_at' };
    expect(buildQueryHash(params)).toBe(buildQueryHash(params));
  });
});

describe('CacheTTL', () => {
  it('encodes the ticket §4.2 TTL policy literally', () => {
    expect(CacheTTL.TAGS).toBeNull();
    expect(CacheTTL.CATEGORIES).toBeNull();
    expect(CacheTTL.LIST).toBe(300);
    expect(CacheTTL.DETAIL).toBeNull();
    expect(CacheTTL.MARKETING).toBeNull();
  });
});
