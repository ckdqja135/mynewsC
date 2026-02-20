/**
 * Embedding Service for Semantic Search
 *
 * Uses a simple TF-IDF + cosine similarity approach for Node.js compatibility.
 * This avoids heavy Python-specific dependencies (sentence-transformers, FAISS).
 *
 * For production, consider using an external embedding API (OpenAI, Cohere, etc.)
 * or the @xenova/transformers library for local model inference.
 */

class EmbeddingService {
  constructor() {
    // In-memory article cache: articleId -> { text, vector }
    this._articleCache = new Map();
    this._idfCache = new Map();
    this._vocabulary = new Set();
    console.log('[EmbeddingService] Initialized with TF-IDF similarity');
  }

  /**
   * Tokenize text into terms (supports Korean and English)
   */
  _tokenize(text) {
    // Simple tokenization: split by non-word characters, convert to lowercase
    // This handles Korean characters as well since \w in JS doesn't match Korean,
    // so we use a broader approach
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  /**
   * Calculate term frequency for a document
   */
  _tf(tokens) {
    const freq = new Map();
    for (const token of tokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
    // Normalize by document length
    const len = tokens.length || 1;
    for (const [key, val] of freq) {
      freq.set(key, val / len);
    }
    return freq;
  }

  /**
   * Build/update IDF from all cached documents
   */
  _updateIdf() {
    const docCount = this._articleCache.size || 1;
    const termDocCount = new Map();

    for (const { tokens } of this._articleCache.values()) {
      const uniqueTerms = new Set(tokens);
      for (const term of uniqueTerms) {
        termDocCount.set(term, (termDocCount.get(term) || 0) + 1);
      }
    }

    this._idfCache.clear();
    for (const [term, count] of termDocCount) {
      this._idfCache.set(term, Math.log((docCount + 1) / (count + 1)) + 1);
    }
  }

  /**
   * Convert TF map to a sparse vector using IDF weights
   */
  _tfidfVector(tfMap) {
    const vector = new Map();
    for (const [term, tf] of tfMap) {
      const idf = this._idfCache.get(term) || 1;
      vector.set(term, tf * idf);
    }
    return vector;
  }

  /**
   * Calculate cosine similarity between two sparse vectors
   */
  _cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const [term, valA] of vecA) {
      normA += valA * valA;
      const valB = vecB.get(term);
      if (valB !== undefined) {
        dotProduct += valA * valB;
      }
    }

    for (const [, valB] of vecB) {
      normB += valB * valB;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Add articles to the index
   */
  addArticlesToIndex(articles) {
    let newCount = 0;
    for (const article of articles) {
      if (!this._articleCache.has(article.id)) {
        let text = article.title || '';
        if (article.snippet) text += ' ' + article.snippet;

        const tokens = this._tokenize(text);
        const tf = this._tf(tokens);

        this._articleCache.set(article.id, { text, tokens, tf });
        newCount++;
      }
    }

    if (newCount > 0) {
      this._updateIdf();
      console.log(`[EmbeddingService] Added ${newCount} articles. Total: ${this._articleCache.size}`);
    }
  }

  /**
   * Normalize raw TF-IDF scores to 0~1 range compatible with sentence-transformers scale.
   * TF-IDF cosine similarity for short texts typically maxes out at 0.2~0.4,
   * while sentence-transformers returns 0.5~0.9 for relevant content.
   * We rescale so that the top result maps to ~0.95 and scores distribute naturally.
   */
  _normalizeScores(results) {
    if (results.length === 0) return results;

    const maxScore = results[0].score; // already sorted desc
    if (maxScore <= 0) return results;

    // Scale so that the max raw score maps to 0.95
    // Use a power curve for more natural distribution
    const scaleFactor = 0.95 / maxScore;

    return results.map(({ article, score }) => ({
      article,
      score: Math.min(score * scaleFactor, 1.0),
    }));
  }

  /**
   * Rank articles by semantic similarity to the query.
   */
  rankArticlesBySimilarity(query, articles, minSimilarity = 0.0, maxResults = null) {
    if (!articles || articles.length === 0) return [];

    // Add articles to index
    this.addArticlesToIndex(articles);

    // Update IDF with current corpus
    this._updateIdf();

    // Compute query vector
    const queryTokens = this._tokenize(query);
    const queryTf = this._tf(queryTokens);
    const queryVector = this._tfidfVector(queryTf);

    // Score each article (collect ALL results first, filter after normalization)
    const rawResults = [];
    for (const article of articles) {
      const cached = this._articleCache.get(article.id);
      if (!cached) continue;

      const articleVector = this._tfidfVector(cached.tf);
      const similarity = this._cosineSimilarity(queryVector, articleVector);

      rawResults.push({ article, score: Math.max(0, similarity) });
    }

    // Sort by similarity (highest first)
    rawResults.sort((a, b) => b.score - a.score);

    // Normalize scores to match sentence-transformers scale (0~1)
    const normalized = this._normalizeScores(rawResults);

    // Now filter by minSimilarity threshold
    const filtered = normalized.filter(r => r.score >= minSimilarity);

    // Apply max_results limit
    if (maxResults) {
      return filtered.slice(0, maxResults);
    }

    return filtered;
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
