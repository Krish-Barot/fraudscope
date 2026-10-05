// apps/api/src/utils/analyticsCache.ts
// Redis cache layer for analytics queries
//
// WHY CACHE ANALYTICS:
// Analytics queries are expensive aggregations across potentially millions
// of rows. The alert volume query alone does a GROUP BY across the full
// alerts table. With 10 analysts all loading the dashboard simultaneously,
// that's 10 identical full-table scans per minute.
//
// With caching: first request hits PostgreSQL, the next 299 seconds of
// requests return the cached result in under 1ms.
//
// CACHE KEY DESIGN:
// cache:analytics:{endpoint}:{rangeHash}
//   endpoint  = 'overview' | 'alert-volume' | 'severity' | ...
//   rangeHash = deterministic hash of from+to parameters
//
// This means:
//   - Same endpoint + same date range → same cache key (hits)
//   - Different date range → different key (fresh query)
//   - Cache busting → skip cache entirely (?bust=true)
//
// TTL is configurable via ANALYTICS_CACHE_TTL env var (default 300s = 5 min).
// 5 minutes means a fraud analyst's dashboard is at most 5 minutes stale.
// For a near-real-time view, the live feed (FS-22) serves that purpose.
// Analytics is intentionally a lagging indicator.

import { redisClient } from '../config/redis';

const CACHE_PREFIX = 'cache:analytics';

// Get TTL from env — fall back to 300 seconds (5 minutes)
function getCacheTTL(): number {
    const envVal = parseInt(process.env.ANALYTICS_CACHE_TTL || '300', 10);
    return isNaN(envVal) || envVal < 0 ? 300 : envVal;
}

// Build a deterministic cache key from endpoint name and query params
// Sorts keys before hashing so { from: 'x', to: 'y' } and { to: 'y', from: 'x' }
// produce the same cache key
export function buildCacheKey(
    endpoint: string,
    params: Record<string, string | undefined>
): string {
    // Remove undefined values, sort keys, stringify
    const normalized = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');

    // Simple deterministic hash of the normalized params string
    // Good enough for cache keys -- not cryptographic
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // convert to 32-bit integer
    }
    const hashStr = Math.abs(hash).toString(36);

    return `${CACHE_PREFIX}:${endpoint}:${hashStr}`;
}

// Try to get a cached response. Returns parsed JSON or null on miss/error.
export async function getCached<T>(key: string): Promise<T | null> {
    try {
        const cached = await redisClient.get(key);
        if (cached === null) return null;
        return JSON.parse(cached) as T;
    } catch {
        // Redis error or JSON parse error -- treat as cache miss, don't crash
        return null;
    }
}

// Store a value in the cache with the configured TTL.
export async function setCached(key: string, data: unknown): Promise<void> {
    try {
        const ttl = getCacheTTL();
        await redisClient.set(key, JSON.stringify(data), 'EX', ttl);
    } catch {
        // Redis write failure is non-fatal -- data is still returned to the client
        // from PostgreSQL. Cache miss on next request is the only consequence.
    }
}

// Delete a specific cache key (used for targeted busting).
export async function deleteCached(key: string): Promise<void> {
    try {
        await redisClient.del(key);
    } catch {
        // Non-fatal
    }
}

// Delete all analytics cache keys (used for full cache bust).
// Uses SCAN instead of KEYS to avoid blocking Redis on large key spaces.
export async function bustAnalyticsCache(): Promise<number> {
    let cursor = '0';
    let deleted = 0;

    do {
        const [nextCursor, keys] = await redisClient.scan(
            cursor,
            'MATCH', `${CACHE_PREFIX}:*`,
            'COUNT', 100
        );
        cursor = nextCursor;

        if (keys.length > 0) {
            await redisClient.del(...keys);
            deleted += keys.length;
        }
    } while (cursor !== '0');

    return deleted;
}

// Helper: check if request has ?bust=true to force cache bypass
export function shouldBustCache(query: Record<string, any>): boolean {
    return query.bust === 'true' || query.bust === '1';
}