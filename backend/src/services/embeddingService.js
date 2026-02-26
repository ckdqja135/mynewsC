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

    // Embed query
    const queryEmbedding = await this._embed(query);

    // Score each article
    const results = [];
    for (const article of articles) {
      const cached = this._articleCache.get(article.id);
      if (!cached) continue;

      const score = this._dotProduct(queryEmbedding, cached.embedding);
      if (score >= minSimilarity) {
        results.push({ article, score: Math.max(0, score) });
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
