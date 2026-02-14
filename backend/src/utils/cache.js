const crypto = require('crypto');

/**
 * Simple in-memory cache with TTL
 */
class SearchCache {
  /**
   * @param {number} ttl - Time to live in seconds (default: 300 = 5 minutes)
   */
  constructor(ttl = 300) {
    this.ttl = ttl;
    this._cache = new Map();
    this._lastCleanup = Date.now();
    this._cleanupInterval = 60 * 1000; // 60 seconds
  }

  _generateKey(params) {
    const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
    const keyString = JSON.stringify(sorted);
    return crypto.createHash('md5').update(keyString).digest('hex');
  }

  _cleanupExpired() {
    const now = Date.now();
    if (now - this._lastCleanup < this._cleanupInterval) return;

    this._lastCleanup = now;
    let expiredCount = 0;
    for (const [key, { timestamp }] of this._cache) {
      if (now - timestamp > this.ttl * 1000) {
        this._cache.delete(key);
        expiredCount++;
      }
    }
    if (expiredCount > 0) {
      console.log(`[CACHE] Cleaned up ${expiredCount} expired entries`);
    }
  }

  get(params) {
    this._cleanupExpired();

    const cacheKey = this._generateKey(params);
    const entry = this._cache.get(cacheKey);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.ttl * 1000) {
      this._cache.delete(cacheKey);
      return null;
    }

    const ageSec = Math.floor((now - entry.timestamp) / 1000);
    console.log(`[CACHE] Hit for key: ${cacheKey.slice(0, 8)}... (age: ${ageSec}s)`);
    return entry.result;
  }

  set(result, params) {
    const cacheKey = this._generateKey(params);
    this._cache.set(cacheKey, { timestamp: Date.now(), result });
    console.log(`[CACHE] Stored result for key: ${cacheKey.slice(0, 8)}... (total entries: ${this._cache.size})`);
  }

  clear() {
    const count = this._cache.size;
    this._cache.clear();
    console.log(`[CACHE] Cleared ${count} entries`);
  }

  getStats() {
    const now = Date.now();
    let validEntries = 0;
    for (const { timestamp } of this._cache.values()) {
      if (now - timestamp <= this.ttl * 1000) validEntries++;
    }

    return {
      total_entries: this._cache.size,
      valid_entries: validEntries,
      expired_entries: this._cache.size - validEntries,
      ttl: this.ttl,
    };
  }
}

// Global cache instances
const keywordSearchCache = new SearchCache(300);  // 5 minutes
const semanticSearchCache = new SearchCache(300); // 5 minutes
const analysisCache = new SearchCache(600);       // 10 minutes

module.exports = { SearchCache, keywordSearchCache, semanticSearchCache, analysisCache };
