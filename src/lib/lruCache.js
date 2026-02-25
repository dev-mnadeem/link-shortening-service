/**
 * Bounded LRU cache with per-entry TTL.
 *
 * Built on `Map`, which iterates in insertion order: deleting and re-setting a
 * key moves it to the end, so the first key returned by `keys()` is always the
 * least recently used one. That keeps get/set/evict at O(1) without a
 * dependency.
 */
export const createLruCache = ({ maxSize = 1000, ttlMs = 60_000, now = Date.now } = {}) => {
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new TypeError("maxSize must be a positive integer.");
  }

  const entries = new Map();
  const stats = { hits: 0, misses: 0, evictions: 0 };

  const evictOldest = () => {
    const oldestKey = entries.keys().next().value;

    if (oldestKey !== undefined) {
      entries.delete(oldestKey);
      stats.evictions += 1;
    }
  };

  return {
    get(key) {
      const entry = entries.get(key);

      if (entry === undefined) {
        stats.misses += 1;
        return undefined;
      }

      if (now() >= entry.expiresAt) {
        entries.delete(key);
        stats.misses += 1;
        return undefined;
      }

      // Refresh recency.
      entries.delete(key);
      entries.set(key, entry);
      stats.hits += 1;

      return entry.value;
    },

    set(key, value, entryTtlMs = ttlMs) {
      if (entries.has(key)) {
        entries.delete(key);
      } else if (entries.size >= maxSize) {
        evictOldest();
      }

      entries.set(key, { value, expiresAt: now() + entryTtlMs });
    },

    delete(key) {
      return entries.delete(key);
    },

    clear() {
      entries.clear();
    },

    get size() {
      return entries.size;
    },

    stats() {
      return { ...stats, size: entries.size };
    },
  };
};
