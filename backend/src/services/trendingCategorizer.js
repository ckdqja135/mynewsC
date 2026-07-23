/**
 * Trending Categorizer
 *
 * 실시간 급상승 검색어를 카테고리(정치/경제/사회/연예/스포츠/IT/생활/문화)로 분류한다.
 * signal.bz 등 트렌드 소스는 카테고리를 제공하지 않으므로 LLM으로 추정하되,
 * 키워드별로 결과를 메모리에 캐시해 매 갱신(30초)마다 LLM을 다시 호출하지 않는다.
 * (트렌드 키워드는 천천히 바뀌므로, 새로 등장한 키워드만 분류하면 됨)
 */
class TrendingCategorizer {
  /**
   * @param {Object} llmService - categorizeKeywords(keywords)를 제공하는 LLM 서비스
   */
  constructor(llmService) {
    this.llm = llmService;
    this.cache = new Map(); // keyword -> category (삽입 순서 = 오래된 순)
    this.maxCache = 500;
  }

  /**
   * 키워드 목록에 카테고리를 부여한다. 캐시에 없는 것만 LLM으로 분류.
   * @param {string[]} keywords
   * @returns {Promise<string[]>} keywords와 같은 순서의 카테고리 배열
   */
  async categorize(keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) return [];

    const uncached = [...new Set(keywords.filter(k => k && !this.cache.has(k)))];

    if (uncached.length > 0 && this.llm) {
      try {
        const cats = await this.llm.categorizeKeywords(uncached);
        uncached.forEach((k, i) => this.cache.set(k, cats[i] || '기타'));
      } catch (err) {
        console.error('[TrendingCategorizer] categorize failed:', err.message);
        // 실패한 키워드는 '기타'로 캐시(다음 호출에서 즉시 재시도 폭주 방지)
        uncached.forEach(k => { if (!this.cache.has(k)) this.cache.set(k, '기타'); });
      }
      this._prune();
    }

    return keywords.map(k => this.cache.get(k) || '기타');
  }

  // 캐시가 maxCache를 넘으면 오래된 항목부터 제거 (Map은 삽입 순서 보존)
  _prune() {
    if (this.cache.size <= this.maxCache) return;
    const excess = this.cache.size - this.maxCache;
    let i = 0;
    for (const key of this.cache.keys()) {
      if (i++ >= excess) break;
      this.cache.delete(key);
    }
  }
}

module.exports = { TrendingCategorizer };
