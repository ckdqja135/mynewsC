/**
 * Embedding Service for Semantic Search
 *
 * Uses @xenova/transformers MiniLM model for real semantic embeddings.
 * Model: paraphrase-multilingual-MiniLM-L12-v2 (384-dim, multilingual including Korean)
 */

class EmbeddingService {
  constructor() {
    this._pipeline = null;
    this._pipelineLoading = null;
    // articleId -> { text, embedding: number[] }
    this._articleCache = new Map();
    console.log('[EmbeddingService] Initialized (MiniLM semantic embeddings)');
  }

  /**
   * Lazy-load the embedding pipeline (with concurrent loading protection)
   */
  async _getEmbeddingPipeline() {
    if (this._pipeline) return this._pipeline;
    if (this._pipelineLoading) return this._pipelineLoading;

    this._pipelineLoading = (async () => {
      console.log('[EmbeddingService] Loading MiniLM embedding model (first time may take a while)...');
      const { pipeline } = await import('@xenova/transformers');
      this._pipeline = await pipeline(
        'feature-extraction',
        'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
      );
      console.log('[EmbeddingService] Embedding model loaded successfully');
      this._pipelineLoading = null;
      return this._pipeline;
    })();

    return this._pipelineLoading;
  }

  /**
   * Generate embedding for a single text
   * @param {string} text
   * @returns {Promise<number[]>} 384-dim normalized vector
   */
  async _embed(text) {
    const pipe = await this._getEmbeddingPipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  /**
   * Dot product of two normalized vectors (= cosine similarity)
   */
  _dotProduct(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * Calculate keyword match boost/penalty.
   * - Query keywords found in title → boost
   * - Query keywords found in snippet only → smaller boost
   * - No keyword match at all → penalty
   *
   * @param {string} query - search query
   * @param {string} title - article title
   * @param {string|null} snippet - article snippet
   * @returns {number} multiplier (e.g. 1.2 for boost, 0.6 for penalty)
   */
  _keywordBoost(query, title, snippet) {
    const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    if (queryTokens.length === 0) return 1.0;

    const titleLower = (title || '').toLowerCase();
    const snippetLower = (snippet || '').toLowerCase();

    // Check full query match first (exact phrase)
    const queryLower = query.toLowerCase().trim();
    if (titleLower.includes(queryLower)) {
      return 1.3; // Strong boost: exact query in title
    }
    if (snippetLower.includes(queryLower)) {
      return 1.15; // Moderate boost: exact query in snippet
    }

    // Check individual token matches
    let titleMatches = 0;
    let snippetMatches = 0;
    for (const token of queryTokens) {
      if (titleLower.includes(token)) titleMatches++;
      else if (snippetLower.includes(token)) snippetMatches++;
    }

    const totalMatches = titleMatches + snippetMatches;
    const matchRatio = totalMatches / queryTokens.length;

    if (titleMatches > 0 && matchRatio >= 0.5) {
      return 1.0 + 0.2 * matchRatio; // Boost proportional to match ratio
    }
    if (snippetMatches > 0 && matchRatio >= 0.5) {
      return 1.0 + 0.1 * matchRatio;
    }

    // No keyword match at all → penalty
    return 0.6;
  }

  /**
   * Add articles to the embedding cache
   */
  async addArticlesToIndex(articles) {
    const newArticles = articles.filter(a => !this._articleCache.has(a.id));
    if (newArticles.length === 0) return;

    console.log(`[EmbeddingService] Embedding ${newArticles.length} new articles...`);

    for (const article of newArticles) {
      let text = article.title || '';
      if (article.snippet) text += ' ' + article.snippet;

      const embedding = await this._embed(text);
      this._articleCache.set(article.id, { text, embedding });
    }

    console.log(`[EmbeddingService] Done. Total cached: ${this._articleCache.size}`);
  }

  /**
   * 청크 배열을 쿼리와의 유사도로 랭킹합니다.
   * @param {string} query
   * @param {Array} chunks - [{chunkId, articleId, text, article, ...}]
   * @param {number} topK - 반환할 상위 청크 수
   * @returns {Promise<Array>} 유사도 순으로 정렬된 청크 배열 (score 필드 포함)
   */
  async rankChunksBySimilarity(query, chunks, topK = 15) {
    if (!chunks || chunks.length === 0) return [];

    const queryEmbedding = await this._embed(query);

    const scored = await Promise.all(
      chunks.map(async chunk => {
        const embedding = await this._embed(chunk.text);
        const score = this._dotProduct(queryEmbedding, embedding);
        return { ...chunk, score };
      })
    );

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Rank articles by semantic similarity to the query.
   * @param {string} query
   * @param {Array} articles - [{id, title, snippet, ...}]
   * @param {number} minSimilarity - threshold (0~1)
   * @param {number|null} maxResults
   * @returns {Promise<Array<{article, score}>>}
   */
  async rankArticlesBySimilarity(query, articles, minSimilarity = 0.0, maxResults = null) {
    if (!articles || articles.length === 0) return [];

    // Embed all articles (cached ones are skipped)
    await this.addArticlesToIndex(articles);

    // Support comma-separated multi-keyword queries
    // Embed each keyword separately and use max similarity per article
    const keywords = query.split(',').map(k => k.trim()).filter(k => k.length > 0);
    const queryEmbeddings = await Promise.all(keywords.map(k => this._embed(k)));

    // Score each article with keyword boosting
    const results = [];
    for (const article of articles) {
      const cached = this._articleCache.get(article.id);
      if (!cached) continue;

      // For each keyword embedding, compute score and take the max
      let bestScore = 0;
      for (let i = 0; i < queryEmbeddings.length; i++) {
        const semanticScore = this._dotProduct(queryEmbeddings[i], cached.embedding);
        const boost = this._keywordBoost(keywords[i], article.title, article.snippet);
        const score = Math.min(1.0, semanticScore * boost);
        if (score > bestScore) bestScore = score;
      }

      if (bestScore >= minSimilarity) {
        results.push({ article, score: Math.max(0, bestScore) });
      }
    }

    // Sort by similarity (highest first)
    results.sort((a, b) => b.score - a.score);

    if (maxResults) {
      return results.slice(0, maxResults);
    }

    return results;
  }
}

// Singleton instance
let _instance = null;

function getEmbeddingService() {
  if (!_instance) {
    _instance = new EmbeddingService();
  }
  return _instance;
}

module.exports = { EmbeddingService, getEmbeddingService };
