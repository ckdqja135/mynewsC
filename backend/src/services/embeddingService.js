/**
 * Embedding Service for Semantic Search
 *
 * Uses @xenova/transformers MiniLM model for real semantic embeddings.
 * Model: paraphrase-multilingual-MiniLM-L12-v2 (384-dim, multilingual including Korean)
 *
 * Phase 2: BM25 + cosine similarity hybrid search via Reciprocal Rank Fusion (RRF).
 */

// ── BM25 helpers ─────────────────────────────────────────────────────────────
const BM25_K1 = 1.5;
const BM25_B  = 0.75;
const RRF_K   = 60;

function _tokenize(text) {
  return (text || '').toLowerCase().split(/[\s,.!?;:()\[\]{}'"><\/\\-]+/).filter(t => t.length >= 2);
}

function _buildBM25Index(docTokensList) {
  const N = docTokensList.length;
  if (N === 0) return { avgDl: 0, idf: new Map() };

  const avgDl = docTokensList.reduce((s, d) => s + d.length, 0) / N;
  const df = new Map();
  for (const tokens of docTokensList) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
  }

  const idf = new Map();
  for (const [t, freq] of df) {
    idf.set(t, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  }
  return { avgDl, idf };
}

function _scoreBM25(queryTokens, docTokens, avgDl, idf) {
  if (avgDl === 0 || docTokens.length === 0 || queryTokens.length === 0) return 0;
  const dl = docTokens.length;
  const tf = new Map();
  for (const t of docTokens) tf.set(t, (tf.get(t) || 0) + 1);

  let score = 0;
  for (const qt of queryTokens) {
    const f = tf.get(qt) || 0;
    if (f === 0) continue;
    const idfScore = idf.get(qt) || 0;
    score += idfScore * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgDl));
  }
  return score;
}
// ─────────────────────────────────────────────────────────────────────────────

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
   * Classify query type to determine BM25 vs semantic weighting.
   * - 'keyword'    (≤2 tokens, no question) → BM25-heavy
   * - 'conceptual' (≥5 tokens or has question word) → semantic-heavy
   * - 'balanced'   (default)
   */
  _classifyQuery(query) {
    const tokens = query.trim().split(/\s+/).filter(t => t.length > 0);
    const questionWords = ['무엇', '어떤', '왜', '어떻게', '언제', '어디서', '누가', 'what', 'why', 'how', 'when', 'where', 'who', 'which'];
    const hasQuestion = questionWords.some(w => query.toLowerCase().includes(w)) || query.includes('?');

    if (tokens.length <= 2 && !hasQuestion) return 'keyword';
    if (tokens.length >= 5 || hasQuestion) return 'conceptual';
    return 'balanced';
  }

  _getHybridWeights(queryType) {
    switch (queryType) {
      case 'keyword':    return { semW: 0.4, bm25W: 0.6 };
      case 'conceptual': return { semW: 0.7, bm25W: 0.3 };
      default:           return { semW: 0.5, bm25W: 0.5 };
    }
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
   * 청크 배열을 쿼리와의 BM25 + 코사인 유사도 RRF 하이브리드로 랭킹합니다.
   * Phase 3: feedbackService가 제공되면 피드백 부스트를 RRF 점수에 반영합니다.
   *
   * @param {string} query
   * @param {Array} chunks - [{chunkId, articleId, text, article, ...}]
   * @param {number} topK - 반환할 상위 청크 수
   * @param {object|null} feedbackService - FeedbackService 인스턴스 (선택)
   * @returns {Promise<Array>} RRF 순으로 정렬된 청크 배열 (score = cosine similarity)
   */
  async rankChunksBySimilarity(query, chunks, topK = 15, feedbackService = null) {
    if (!chunks || chunks.length === 0) return [];

    const queryType = this._classifyQuery(query);
    const { semW, bm25W } = this._getHybridWeights(queryType);

    const queryEmbedding = await this._embed(query);
    const queryTokens = _tokenize(query);
    const docTokensList = chunks.map(c => _tokenize(c.text));
    const { avgDl, idf } = _buildBM25Index(docTokensList);

    const scored = await Promise.all(
      chunks.map(async (chunk, i) => {
        const embedding = await this._embed(chunk.text);
        const semScore = this._dotProduct(queryEmbedding, embedding);
        const bm25Score = _scoreBM25(queryTokens, docTokensList[i], avgDl, idf);
        return { ...chunk, score: semScore, bm25Score };
      })
    );

    // RRF fusion
    const semRanked  = [...scored].sort((a, b) => b.score - a.score);
    const bm25Ranked = [...scored].sort((a, b) => b.bm25Score - a.bm25Score);
    const rrfMap = new Map();
    semRanked.forEach(({ chunkId }, rank) =>
      rrfMap.set(chunkId, (rrfMap.get(chunkId) || 0) + semW / (RRF_K + rank + 1)));
    bm25Ranked.forEach(({ chunkId }, rank) =>
      rrfMap.set(chunkId, (rrfMap.get(chunkId) || 0) + bm25W / (RRF_K + rank + 1)));

    // Phase 3 — 피드백 부스트: net 좋아요 수에 비례해 RRF 점수 조정
    if (feedbackService) {
      const rrfMax = 1 / (RRF_K + 1); // RRF 최대값 기준 (~0.0164)
      for (const chunk of scored) {
        const articleId = chunk.article?.id || chunk.articleId;
        const boost = feedbackService.getBoost(articleId);
        if (boost !== 0) {
          rrfMap.set(chunk.chunkId, (rrfMap.get(chunk.chunkId) || 0) + boost * rrfMax);
        }
      }
    }

    scored.sort((a, b) => (rrfMap.get(b.chunkId) || 0) - (rrfMap.get(a.chunkId) || 0));
    return scored.slice(0, topK);
  }

  /**
   * Rank articles by BM25 + cosine similarity hybrid (Reciprocal Rank Fusion).
   * Query type is auto-classified to adjust BM25 vs semantic weight.
   *
   * @param {string} query
   * @param {Array} articles - [{id, title, snippet, ...}]
   * @param {number} minSimilarity - cosine similarity threshold (0~1) for filtering
   * @param {number|null} maxResults
   * @returns {Promise<Array<{article, score}>>} sorted by RRF, score = cosine similarity
   */
  async rankArticlesBySimilarity(query, articles, minSimilarity = 0.0, maxResults = null) {
    if (!articles || articles.length === 0) return [];

    await this.addArticlesToIndex(articles);

    const keywords = query.split(',').map(k => k.trim()).filter(k => k.length > 0);
    const queryType = this._classifyQuery(query);
    const { semW, bm25W } = this._getHybridWeights(queryType);
    console.log(`[EmbeddingService] query="${query}" type=${queryType} semW=${semW} bm25W=${bm25W}`);

    // 1. Semantic scores — per keyword, take max
    const queryEmbeddings = await Promise.all(keywords.map(k => this._embed(k)));
    const semanticScores = new Map();
    for (const article of articles) {
      const cached = this._articleCache.get(article.id);
      if (!cached) continue;
      let best = 0;
      for (const qe of queryEmbeddings) {
        const s = this._dotProduct(qe, cached.embedding);
        if (s > best) best = s;
      }
      semanticScores.set(article.id, Math.max(0, best));
    }

    // 2. BM25 scores — union of all keyword tokens against title+snippet
    const allQueryTokens = keywords.flatMap(k => _tokenize(k));
    const docTokensList = articles.map(a => _tokenize((a.title || '') + ' ' + (a.snippet || '')));
    const { avgDl, idf } = _buildBM25Index(docTokensList);
    const bm25Scores = new Map();
    articles.forEach((article, i) => {
      bm25Scores.set(article.id, _scoreBM25(allQueryTokens, docTokensList[i], avgDl, idf));
    });

    // 3. RRF fusion
    const validArticles = articles.filter(a => semanticScores.has(a.id));
    const semRanked  = [...validArticles].sort((a, b) => (semanticScores.get(b.id) || 0) - (semanticScores.get(a.id) || 0));
    const bm25Ranked = [...validArticles].sort((a, b) => (bm25Scores.get(b.id) || 0)  - (bm25Scores.get(a.id)  || 0));

    const rrfScores = new Map();
    semRanked.forEach(({ id }, rank) =>
      rrfScores.set(id, (rrfScores.get(id) || 0) + semW  / (RRF_K + rank + 1)));
    bm25Ranked.forEach(({ id }, rank) =>
      rrfScores.set(id, (rrfScores.get(id) || 0) + bm25W / (RRF_K + rank + 1)));

    // 4. Collect, filter by semantic score, sort by RRF
    const results = [];
    for (const article of validArticles) {
      const semScore = semanticScores.get(article.id) || 0;
      if (semScore < minSimilarity) continue;
      results.push({ article, score: semScore, rrf_score: rrfScores.get(article.id) || 0 });
    }

    results.sort((a, b) => b.rrf_score - a.rrf_score);

    if (maxResults) return results.slice(0, maxResults);
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
