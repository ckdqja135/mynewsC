require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const { createRateLimiter } = require('./middleware/rateLimit');
const { NewsCrawler } = require('./services/newsCrawler');
const { RSSParserService } = require('./services/rssParser');
const { keywordSearchCache, semanticSearchCache, analysisCache } = require('./utils/cache');

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: '*',
  credentials: true,
}));

const rateLimit = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10);
app.use(createRateLimiter(rateLimit));

// Initialize services (no API keys needed)
const crawler = new NewsCrawler();

const { NaverNewsService } = require('./services/naverNews');
const naverService = new NaverNewsService();

// RSS Parser (always available)
const rssParser = new RSSParserService();

// Embedding Service (for semantic search)
let embeddingService = null;
try {
  const { getEmbeddingService } = require('./services/embeddingService');
  embeddingService = getEmbeddingService();
} catch (err) {
  console.warn(`Failed to initialize embedding service: ${err.message}`);
  console.warn('Semantic search will not be available');
}

// LLM Service (for news analysis)
let llmService = null;
try {
  const { getLlmService } = require('./services/llmService');
  llmService = getLlmService();
} catch (err) {
  console.warn(`Failed to initialize LLM service: ${err.message}`);
  console.warn('News analysis will not be available');
}

// ==================== Helper functions ====================

function validateSearchRequest(body) {
  const q = (body.q || '').trim();
  if (!q || q.length === 0 || q.length > 200) {
    return { error: 'Query must be 1-200 characters' };
  }
  const hl = body.hl || 'ko';
  const gl = body.gl || 'kr';
  const num = Math.min(Math.max(parseInt(body.num, 10) || 100, 1), 500);
  const excluded_sources = body.excluded_sources || [];
  return { q, hl, gl, num, excluded_sources };
}

/**
 * Fetch news from all sources concurrently
 */
async function fetchFromAllSources(q, hl, gl, num, excludedSources, rssMaxPerFeed = 20) {
  const tasks = [];

  // 1. Google News (RSS) - limit to 100
  if (!excludedSources.includes('google_news')) {
    tasks.push(crawler.searchNews(q, hl, gl, Math.min(num, 100)));
  } else {
    console.log('[DEBUG] Skipping Google News (excluded)');
  }

  // 2. Naver News (scraping) - up to 1000
  if (!excludedSources.includes('naver')) {
    tasks.push(naverService.searchNews(q, Math.min(num, 1000)));
  } else {
    console.log('[DEBUG] Skipping Naver News (excluded)');
  }

  // 3. RSS Feeds
  tasks.push(rssParser.searchNews(q, rssMaxPerFeed, excludedSources));

  const results = await Promise.allSettled(tasks);

  // Combine results
  const allArticles = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allArticles.push(...result.value);
    }
  }

  return allArticles;
}

/**
 * Deduplicate and filter articles
 */
function deduplicateAndFilter(articles, excludedSources) {
  // Filter by excluded sources
  let filtered = articles;
  if (excludedSources && excludedSources.length > 0) {
    const before = filtered.length;
    filtered = filtered.filter(a => !excludedSources.includes(a.source));
    console.log(`[DEBUG] Filtered ${before - filtered.length} articles from excluded sources`);
  }

  // Remove duplicates by ID
  const seenIds = new Set();
  const unique = [];
  for (const article of filtered) {
    if (!seenIds.has(article.id)) {
      seenIds.add(article.id);
      unique.push(article);
    }
  }

  return unique;
}

/**
 * Sort articles by date (newest first)
 */
function sortByDate(articles) {
  return articles.sort((a, b) => {
    const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return dateB - dateA;
  });
}

// ==================== Routes ====================

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.get('/', (req, res) => {
  res.json({
    message: 'News Crawler API',
    docs: '/docs',
    health: '/health',
  });
});

app.get('/api/cache/stats', (req, res) => {
  res.json({
    keyword_search: keywordSearchCache.getStats(),
    semantic_search: semanticSearchCache.getStats(),
    analysis: analysisCache.getStats(),
  });
});

app.post('/api/cache/clear', (req, res) => {
  keywordSearchCache.clear();
  semanticSearchCache.clear();
  analysisCache.clear();
  res.json({ status: 'success', message: 'All caches cleared' });
});

// ==================== News Search ====================

app.post('/api/news/search', async (req, res) => {
  const params = validateSearchRequest(req.body);
  if (params.error) return res.status(400).json({ detail: params.error });

  const { q, hl, gl, num, excluded_sources } = params;

  // Check cache
  const cacheParams = { q, hl, gl, num, excluded_sources: [...excluded_sources].sort().join(',') };
  const cached = keywordSearchCache.get(cacheParams);
  if (cached) {
    console.log(`[CACHE] Returning cached results for keyword search: ${q}`);
    return res.json(cached);
  }

  try {
    const allArticles = await fetchFromAllSources(q, hl, gl, num, excluded_sources, 20);
    console.log(`[DEBUG] Keyword search - Fetched ${allArticles.length} articles total`);

    const uniqueArticles = deduplicateAndFilter(allArticles, excluded_sources);
    console.log(`[DEBUG] Keyword search - After deduplication: ${uniqueArticles.length} unique articles`);

    sortByDate(uniqueArticles);

    const response = {
      articles: uniqueArticles,
      total: uniqueArticles.length,
      query: q,
    };

    keywordSearchCache.set(response, cacheParams);
    res.json(response);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ detail: `Failed to fetch news: ${err.message}` });
  }
});

// ==================== Semantic Search ====================

app.post('/api/news/semantic-search', async (req, res) => {
  if (!embeddingService) {
    return res.status(503).json({
      detail: 'Semantic search is not available. Embedding service failed to initialize.',
    });
  }

  const params = validateSearchRequest(req.body);
  if (params.error) return res.status(400).json({ detail: params.error });

  const { q, hl, gl, num, excluded_sources } = params;
  const minSimilarity = parseFloat(req.body.min_similarity) || 0.0;

  // Check cache
  const cacheParams = {
    q, hl, gl, num, min_similarity: minSimilarity,
    excluded_sources: [...excluded_sources].sort().join(','),
  };
  const cached = semanticSearchCache.get(cacheParams);
  if (cached) {
    console.log(`[CACHE] Returning cached results for semantic search: ${q}`);
    return res.json(cached);
  }

  try {
    const allArticles = await fetchFromAllSources(q, hl, gl, num, excluded_sources, 30);
    console.log(`[DEBUG] Fetched ${allArticles.length} articles total`);

    const uniqueArticles = deduplicateAndFilter(allArticles, excluded_sources);
    console.log(`[DEBUG] After deduplication: ${uniqueArticles.length} unique articles`);

    // Rank by semantic similarity
    const rankedResults = embeddingService.rankArticlesBySimilarity(
      q, uniqueArticles, minSimilarity, num * 2
    );

    console.log(`[DEBUG] After semantic filtering (min_similarity=${minSimilarity}): ${rankedResults.length} articles`);

    const articlesWithScores = rankedResults.map(({ article, score }) => ({
      ...article,
      similarity_score: score,
    }));

    const response = {
      articles: articlesWithScores,
      total: articlesWithScores.length,
      query: q,
    };

    semanticSearchCache.set(response, cacheParams);
    res.json(response);
  } catch (err) {
    console.error('Semantic search error:', err);
    res.status(500).json({ detail: `Failed to perform semantic search: ${err.message}` });
  }
});

// ==================== News Analysis ====================

app.post('/api/news/analyze', async (req, res) => {
  if (!llmService) {
    return res.status(503).json({
      detail: 'News analysis is not available. LLM service failed to initialize.',
    });
  }

  const params = validateSearchRequest(req.body);
  if (params.error) return res.status(400).json({ detail: params.error });

  const { q, hl, gl, excluded_sources } = params;
  const num = Math.min(Math.max(parseInt(req.body.num, 10) || 20, 1), 100);
  const analysisType = req.body.analysis_type || 'comprehensive';
  const daysBack = Math.min(Math.max(parseInt(req.body.days_back, 10) || 30, 1), 365);

  const validTypes = ['comprehensive', 'trend', 'sentiment', 'key_points'];
  if (!validTypes.includes(analysisType)) {
    return res.status(400).json({ detail: `Invalid analysis_type: ${analysisType}` });
  }

  // Check cache
  const cacheParams = {
    q, hl, gl, num, analysis_type: analysisType, days_back: daysBack,
    excluded_sources: [...excluded_sources].sort().join(','),
  };
  const cached = analysisCache.get(cacheParams);
  if (cached) {
    console.log(`[CACHE] Returning cached analysis for: ${q}`);
    return res.json(cached);
  }

  try {
    const allArticles = await fetchFromAllSources(q, hl, gl, num, excluded_sources, 30);
    console.log(`[DEBUG] Analysis - Fetched ${allArticles.length} articles total`);

    const uniqueArticles = deduplicateAndFilter(allArticles, excluded_sources);
    console.log(`[DEBUG] Analysis - After deduplication: ${uniqueArticles.length} unique articles`);

    if (uniqueArticles.length === 0) {
      return res.status(404).json({ detail: 'No articles found for the given query' });
    }

    // Filter by date (last N days)
    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const filteredArticles = uniqueArticles.filter(article => {
      const articleDate = article.publishedAt ? new Date(article.publishedAt) : new Date(0);
      return articleDate >= cutoffDate;
    });

    console.log(`[DEBUG] Analysis - After date filtering (last ${daysBack} days): ${filteredArticles.length} articles`);

    if (filteredArticles.length === 0) {
      return res.status(404).json({
        detail: `No articles found in the last ${daysBack} days for the given query`,
      });
    }

    // Sort by date and limit
    sortByDate(filteredArticles);
    const articlesToAnalyze = filteredArticles.slice(0, num);

    // Perform analysis
    let analysisResult;
    switch (analysisType) {
      case 'comprehensive':
        analysisResult = await llmService.analyzeComprehensive(q, articlesToAnalyze);
        break;
      case 'sentiment':
        analysisResult = await llmService.analyzeSentiment(q, articlesToAnalyze);
        break;
      case 'trend':
        analysisResult = await llmService.analyzeTrends(q, articlesToAnalyze);
        break;
      case 'key_points':
        analysisResult = await llmService.extractKeyPoints(q, articlesToAnalyze);
        break;
    }

    console.log(`[DEBUG] Analysis completed: ${analysisType}`);

    analysisCache.set(analysisResult, cacheParams);
    res.json(analysisResult);
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ detail: `Failed to analyze news: ${err.message}` });
  }
});

// ==================== Debug Endpoint ====================

app.get('/api/news/debug', async (req, res) => {
  const q = req.query.q || 'test';

  try {
    const googleResults = await crawler.searchNews(q, 'ko', 'kr', 5);
    const naverResults = await naverService.searchNews(q, 5);

    res.json({
      google_news: {
        total: googleResults.length,
        first_item: googleResults[0] || null,
      },
      naver_news: {
        total: naverResults.length,
        first_item: naverResults[0] || null,
      },
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ==================== Start Server ====================

const PORT = parseInt(process.env.PORT || '8000', 10);
app.listen(PORT, () => {
  console.log(`News Crawler API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
