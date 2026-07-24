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

// Global cache instances — TTL은 .env로 조절 가능 (초 단위)
// 분석 캐시는 LLM 호출을 아끼는 핵심이라 기본값을 넉넉히(30분) 둔다.
// 같은 인기 주제를 여러 명이 분석하면 캐시 히트로 LLM 호출이 발생하지 않는다.
const _ttl = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const keywordSearchCache = new SearchCache(_ttl(process.env.CACHE_TTL_SEARCH, 300));    // 기본 5분
const semanticSearchCache = new SearchCache(_ttl(process.env.CACHE_TTL_SEARCH, 300));   // 기본 5분
const analysisCache = new SearchCache(_ttl(process.env.CACHE_TTL_ANALYSIS, 1800));      // 기본 30분

module.exports = { SearchCache, keywordSearchCache, semanticSearchCache, analysisCache };
