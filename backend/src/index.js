require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const { createRateLimiter } = require('./middleware/rateLimit');
const { NewsCrawler } = require('./services/newsCrawler');
const { RSSParserService } = require('./services/rssParser');
const { keywordSearchCache, semanticSearchCache, analysisCache } = require('./utils/cache');

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
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

const { DaumNewsService } = require('./services/daumNews');
const daumService = new DaumNewsService();

const { enrichSnippets, inferSourceFromUrl, generateSnippetsWithLLM } = require('./utils/snippetEnricher');

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

// Article Sentiment Classifier
const { ArticleSentimentClassifier, DEFAULT_POSITIVE_KEYWORDS, DEFAULT_NEGATIVE_KEYWORDS } = require('./services/articleSentimentClassifier');
const sentimentClassifier = new ArticleSentimentClassifier();

// Feedback Service (Phase 3)
const { getFeedbackService } = require('./services/feedbackService');
const feedbackService = getFeedbackService();

// Sentiment Trainer (embedding-based classifier)
let sentimentTrainer = null;
try {
  const { getSentimentTrainer } = require('./services/sentimentTrainer');
  sentimentTrainer = getSentimentTrainer();
} catch (err) {
  console.warn(`Failed to initialize sentiment trainer: ${err.message}`);
  console.warn('Sentiment training will not be available');
}

// Lark Bot Service
const { LarkBotService } = require('./services/larkBot');
const larkBot = new LarkBotService();

// Scheduler Service
const { SchedulerService } = require('./services/schedulerService');
const scheduler = new SchedulerService();

// Lark 설정 영구 저장 경로
const fs = require('fs');
const LARK_CONFIG_FILE = require('path').join(__dirname, '..', 'data', 'lark_config.json');

function saveLarkConfigToFile(config) {
  try {
    const dir = require('path').dirname(LARK_CONFIG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LARK_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[Lark] Config saved to file');
  } catch (err) {
    console.error('[Lark] Failed to save config to file:', err.message);
  }
}

function loadLarkConfigFromFile() {
  try {
    if (fs.existsSync(LARK_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(LARK_CONFIG_FILE, 'utf-8'));
      console.log('[Lark] Config loaded from file');
      return data;
    }
  } catch (err) {
    console.warn('[Lark] Failed to load config from file:', err.message);
  }
  return null;
}

// ==================== Helper functions ====================

function validateSearchRequest(body) {
  const q = (body.q || '').trim();
  if (!q || q.length === 0 || q.length > 200) {
    return { error: 'Query must be 1-200 characters' };
  }
  const hl = body.hl || 'ko';
  const gl = body.gl || 'kr';
  const num = Math.min(Math.max(parseInt(body.num, 10) || 100, 1), 1000);
  const excluded_sources = body.excluded_sources || [];
  return { q, hl, gl, num, excluded_sources };
}

/**
 * Parse comma-separated query into individual keywords.
 * Trims whitespace and filters empty strings.
 * @param {string} q - Comma-separated query string
 * @returns {string[]} - Array of individual keywords
 */
function parseMultiKeywords(q) {
  return q.split(',').map(k => k.trim()).filter(k => k.length > 0);
}

/**
 * Fetch news from all sources for multiple keywords concurrently.
 * Combines results from all keywords, deduplicates, and sorts by date.
 * @param {string[]} keywords - Array of keywords
 * @param {string} hl
 * @param {string} gl
 * @param {number} num - Max total articles
 * @param {Array} excludedSources
 * @param {number} rssMaxPerFeed
 * @returns {Promise<Array>}
 */
async function fetchFromAllSourcesMulti(keywords, hl, gl, num, excludedSources, rssMaxPerFeed = 100) {
  if (keywords.length <= 1) {
    const articles = await fetchFromAllSources(keywords[0] || '', hl, gl, num, excludedSources, rssMaxPerFeed);
    if (keywords[0]) {
      articles.forEach(a => { a.matchedKeyword = keywords[0]; });
    }
    return articles;
  }

  // 각 키워드별로 균등하게 할당 (넉넉히 가져온 후 합쳐서 제한)
  const perKeywordNum = Math.ceil(num / keywords.length) + 50;
  const keywordPromises = keywords.map(keyword =>
    fetchFromAllSources(keyword, hl, gl, perKeywordNum, excludedSources, rssMaxPerFeed)
  );

  const results = await Promise.allSettled(keywordPromises);
  const allArticles = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      // 각 기사에 매칭된 키워드 태깅
      result.value.forEach(article => {
        article.matchedKeyword = keywords[i];
      });
      console.log(`[DEBUG] Keyword "${keywords[i]}" returned ${result.value.length} articles`);
      allArticles.push(...result.value);
    } else if (result.status === 'rejected') {
      console.error(`[DEBUG] Keyword "${keywords[i]}" search failed:`, result.reason);
    }
  }

  return allArticles;
}

/**
 * Fetch news from all sources concurrently
 */
async function fetchFromAllSources(q, hl, gl, num, excludedSources, rssMaxPerFeed = 100) {
  const tasks = [];

  // 1. Google News (RSS) - multiple time-range queries
  if (!excludedSources.includes('google_news')) {
    tasks.push(crawler.searchNews(q, hl, gl, num));
  } else {
    console.log('[DEBUG] Skipping Google News (excluded)');
  }

  // 2. Naver News (scraping) - parallel batch, up to 1000
  if (!excludedSources.includes('naver')) {
    tasks.push(naverService.searchNews(q, Math.min(num, 1000)));
  } else {
    console.log('[DEBUG] Skipping Naver News (excluded)');
  }

  // 3. Daum News
  if (!excludedSources.includes('daum')) {
    tasks.push(daumService.searchNews(q, Math.min(num, 1000)));
  } else {
    console.log('[DEBUG] Skipping Daum News (excluded)');
  }

  // 4. RSS Feeds - disabled
  // tasks.push(rssParser.searchNews(q, rssMaxPerFeed, excludedSources));

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
 * Normalize title for dedup comparison.
 * Strips whitespace, special chars, brackets, and lowercases.
 */
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/\[.*?\]/g, '')   // remove [brackets]
    .replace(/【.*?】/g, '')    // remove 【brackets】
    .replace(/\(.*?\)/g, '')   // remove (parens)
    .replace(/[^\w가-힣a-z0-9]/g, '') // keep only alphanumeric + Korean
    .trim();
}

/**
 * Check if two titles are similar enough to be duplicates.
 * Uses normalized exact match + Jaccard bigram similarity for near-duplicates.
 */
function areTitlesSimilar(titleA, titleB, threshold = 0.75) {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);

  // Exact normalized match
  if (normA === normB) return true;
  if (!normA || !normB) return false;

  // Bigram-based Jaccard similarity for near-duplicates
  const bigramsA = new Set();
  const bigramsB = new Set();
  for (let i = 0; i < normA.length - 1; i++) bigramsA.add(normA.slice(i, i + 2));
  for (let i = 0; i < normB.length - 1; i++) bigramsB.add(normB.slice(i, i + 2));

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  const union = bigramsA.size + bigramsB.size - intersection;
  if (union === 0) return false;

  return (intersection / union) >= threshold;
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

  // Phase 1: Remove exact duplicates by ID
  const seenIds = new Set();
  const uniqueById = [];
  for (const article of filtered) {
    if (!seenIds.has(article.id)) {
      seenIds.add(article.id);
      uniqueById.push(article);
    }
  }

  // Phase 2: Remove duplicates by similar title
  const unique = [];
  let titleDupes = 0;
  for (const article of uniqueById) {
    const isDupe = unique.some(existing => areTitlesSimilar(existing.title, article.title));
    if (!isDupe) {
      unique.push(article);
    } else {
      titleDupes++;
    }
  }

  if (titleDupes > 0) {
    console.log(`[DEDUP] Removed ${titleDupes} title-similar duplicates (${uniqueById.length} → ${unique.length})`);
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
    const keywords = parseMultiKeywords(q);
    const allArticles = await fetchFromAllSourcesMulti(keywords, hl, gl, num, excluded_sources, 100);
    console.log(`[DEBUG] Keyword search - Fetched ${allArticles.length} articles total (keywords: ${keywords.join(', ')})`);

    const uniqueArticles = deduplicateAndFilter(allArticles, excluded_sources);
    console.log(`[DEBUG] Keyword search - After deduplication: ${uniqueArticles.length} unique articles`);

    sortByDate(uniqueArticles);

    // Limit to requested number of articles
    const limitedArticles = uniqueArticles.slice(0, num);

    // Enrich snippets with real article descriptions
    await enrichSnippets(limitedArticles);

    // Infer missing sources from URL domain
    for (const a of limitedArticles) {
      if (!a.source) a.source = inferSourceFromUrl(a.url) || 'Unknown';
    }

    const response = {
      articles: limitedArticles,
      total: limitedArticles.length,
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
  const rawSimilarity = parseFloat(req.body.min_similarity);
  const minSimilarity = isNaN(rawSimilarity) ? 0.3 : rawSimilarity;

  // Check cache
  const cacheParams = {
    q, hl, gl, min_similarity: minSimilarity,
    excluded_sources: [...excluded_sources].sort().join(','),
  };
  const cached = semanticSearchCache.get(cacheParams);
  if (cached) {
    console.log(`[CACHE] Returning cached results for semantic search: ${q}`);
    return res.json(cached);
  }

  try {
    // 시맨틱 검색은 소스별 최대치로 수집 후 유사도로 필터링
    const keywords = parseMultiKeywords(q);
    const allArticles = await fetchFromAllSourcesMulti(keywords, hl, gl, 1000, excluded_sources, 100);
    console.log(`[DEBUG] Fetched ${allArticles.length} articles total (keywords: ${keywords.join(', ')})`);

    const uniqueArticles = deduplicateAndFilter(allArticles, excluded_sources);
    const totalCollected = uniqueArticles.length;
    console.log(`[DEBUG] After deduplication: ${totalCollected} unique articles`);

    // min_similarity threshold 이상인 것만 반환 (num으로 자르지 않음)
    const rankedResults = await embeddingService.rankArticlesBySimilarity(
      q, uniqueArticles, minSimilarity, null
    );

    console.log(`[DEBUG] After semantic filtering (min_similarity=${minSimilarity}): ${rankedResults.length} articles`);

    let articlesWithScores = rankedResults.map(({ article, score }) => ({
      ...article,
      similarity_score: score,
    }));

    // LLM 리랭킹: min_similarity가 0.5 이상일 때만 적용
    // (낮은 threshold = 폭넓게 보겠다는 의도이므로 리랭킹으로 줄이지 않음)
    const RERANK_MIN_SIMILARITY = 0.5;
    if (llmService && articlesWithScores.length > 0 && minSimilarity >= RERANK_MIN_SIMILARITY) {
      try {
        const LLM_RERANK_LIMIT = 200;
        const RELEVANCE_THRESHOLD = 3;
        const toRerank = articlesWithScores.slice(0, LLM_RERANK_LIMIT);
        const remaining = articlesWithScores.slice(LLM_RERANK_LIMIT);

        console.log(`[DEBUG] LLM reranking top ${toRerank.length} articles (min_similarity=${minSimilarity} >= ${RERANK_MIN_SIMILARITY})...`);
        const reranked = await llmService.rerankArticles(toRerank, q);

        const filtered = reranked
          .filter(({ relevance_score }) => relevance_score >= RELEVANCE_THRESHOLD)
          .map(({ article, relevance_score }) => ({
            ...article,
            relevance_score,
          }));

        console.log(`[DEBUG] After LLM reranking: ${filtered.length}/${toRerank.length} passed (threshold=${RELEVANCE_THRESHOLD})`);

        articlesWithScores = [...filtered, ...remaining];
      } catch (err) {
        console.warn(`[WARN] LLM reranking failed, using MiniLM results only: ${err.message}`);
      }
    } else if (llmService && minSimilarity < RERANK_MIN_SIMILARITY) {
      console.log(`[DEBUG] Skipping LLM reranking (min_similarity=${minSimilarity} < ${RERANK_MIN_SIMILARITY})`);
    }

    // Enrich snippets with real article descriptions
    await enrichSnippets(articlesWithScores);

    // Infer missing sources from URL domain
    for (const a of articlesWithScores) {
      if (!a.source) a.source = inferSourceFromUrl(a.article?.url || a.url) || 'Unknown';
    }

    // LLM fallback for articles still missing snippets
    if (llmService) await generateSnippetsWithLLM(articlesWithScores, llmService);

    const response = {
      articles: articlesWithScores,
      total: articlesWithScores.length,
      total_collected: totalCollected,
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
  // LLM 분석으로 장시간 소요 → 타임아웃 비활성화
  req.setTimeout(0);
  res.setTimeout(0);

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
  const providedArticles = req.body.articles; // 프론트엔드에서 필터링된 기사 전달 가능

  const validTypes = ['comprehensive', 'trend', 'sentiment', 'key_points'];
  if (!validTypes.includes(analysisType)) {
    return res.status(400).json({ detail: `Invalid analysis_type: ${analysisType}` });
  }

  // Check cache
  const cacheParams = {
    q, hl, gl, num, analysis_type: analysisType, days_back: daysBack,
    excluded_sources: [...excluded_sources].sort().join(','),
    hasProvidedArticles: !!providedArticles,
  };
  const cached = analysisCache.get(cacheParams);
  if (cached) {
    console.log(`[CACHE] Returning cached analysis for: ${q}`);
    return res.json(cached);
  }

  try {
    let articlesToAnalyze;

    // 프론트엔드에서 필터링된 기사가 제공된 경우 사용
    if (providedArticles && Array.isArray(providedArticles) && providedArticles.length > 0) {
      console.log(`[DEBUG] Analysis - Using ${providedArticles.length} provided articles (pre-filtered)`);
      articlesToAnalyze = providedArticles.slice(0, num);
    } else {
      // 기존 방식: 크롤링 후 필터링
      const allArticles = await fetchFromAllSources(q, hl, gl, num, excluded_sources, 100);
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
      articlesToAnalyze = filteredArticles.slice(0, num);
    }

    // RAG 파이프라인: 본문 fetch → 청킹 → 유사도 랭킹
    const { fetchArticleBodies } = require('./services/articleFetcher');
    const { chunkText } = require('./services/chunkingService');

    const FETCH_LIMIT = 15;
    // Google News RSS URLs can't be fetched directly — prefer direct newspaper URLs
    const sortedForFetch = [...articlesToAnalyze].sort((a, b) => {
      const aIsGoogle = (a.url || '').includes('news.google.com') ? 1 : 0;
      const bIsGoogle = (b.url || '').includes('news.google.com') ? 1 : 0;
      return aIsGoogle - bIsGoogle;
    });
    const articlesForFetch = sortedForFetch.slice(0, FETCH_LIMIT);

    console.log(`[RAG] Fetching full bodies for ${articlesForFetch.length} articles...`);
    const articlesWithBody = await fetchArticleBodies(articlesForFetch);
    const fetchedCount = articlesWithBody.filter(a => a.fullText).length;
    console.log(`[RAG] Fetched: ${fetchedCount}/${articlesForFetch.length}`);

    const allChunks = [];
    for (const article of articlesWithBody) {
      if (article.fullText) {
        const chunks = chunkText(article.fullText, article.id);
        chunks.forEach(chunk => allChunks.push({ ...chunk, article }));
      }
    }
    console.log(`[RAG] Total chunks: ${allChunks.length}`);

    let contextChunks = null;
    if (allChunks.length > 0 && embeddingService) {
      contextChunks = await embeddingService.rankChunksBySimilarity(q, allChunks, 10, feedbackService);
      console.log(`[RAG] Top chunks selected: ${contextChunks.length}`);
    }

    // Perform analysis
    let analysisResult;
    switch (analysisType) {
      case 'comprehensive':
        analysisResult = await llmService.analyzeComprehensive(q, articlesToAnalyze, contextChunks);
        break;
      case 'sentiment':
        analysisResult = await llmService.analyzeSentiment(q, articlesToAnalyze, contextChunks);
        break;
      case 'trend':
        analysisResult = await llmService.analyzeTrends(q, articlesToAnalyze, contextChunks);
        break;
      case 'key_points':
        analysisResult = await llmService.extractKeyPoints(q, articlesToAnalyze, contextChunks);
        break;
    }

    console.log(`[DEBUG] Analysis completed: ${analysisType}`);

    analysisCache.set(analysisResult, cacheParams);
    res.json(analysisResult);
  } catch (err) {
    console.error('Analysis error:', err.status ? `[${err.status}] ${err.message}` : err.message || err);
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

// ==================== Sentiment Classification ====================

// LLM 기반 감성 분류
app.post('/api/news/classify-sentiment', async (req, res) => {
  // LLM 배치 처리로 장시간 소요 → 타임아웃 비활성화
  req.setTimeout(0);
  res.setTimeout(0);

  if (!llmService) {
    return res.status(503).json({
      detail: 'LLM service is not available',
    });
  }

  const { articles, query, sentimentTypes } = req.body;

  if (!Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ detail: 'Articles array is required' });
  }

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ detail: 'Query is required' });
  }

  try {
    console.log(`[Sentiment] Classifying ${articles.length} articles for query: ${query}`);

    // LLM 기반 감성 분류 (sentimentTrainer로 자동 라벨 수집)
    const classifiedArticles = await sentimentClassifier.classifyArticlesWithLLM(
      articles,
      llmService,
      query,
      sentimentTrainer
    );

    console.log(`[Sentiment] Classification completed`);

    // 감성 타입으로 필터링 (선택사항)
    let filteredArticles = classifiedArticles;
    if (sentimentTypes && Array.isArray(sentimentTypes) && sentimentTypes.length > 0) {
      filteredArticles = sentimentClassifier.filterBySentiment(classifiedArticles, sentimentTypes);
      console.log(`[Sentiment] Filtered to ${filteredArticles.length} articles with sentiment types: ${sentimentTypes.join(', ')}`);
    }

    // 전체 통계 (필터링 전)
    const allStats = sentimentClassifier.getStatistics(classifiedArticles);
    // 필터링된 통계
    const filteredStats = sentimentClassifier.getStatistics(filteredArticles);

    res.json({
      articles: filteredArticles,
      statistics: filteredStats,
      allStatistics: allStats, // 필터링 전 전체 통계도 함께 반환
      total: filteredArticles.length,
      totalClassified: classifiedArticles.length,
      query
    });
  } catch (error) {
    console.error('[Sentiment] Classification error:', error.status ? `[${error.status}] ${error.message}` : error.message || error);
    res.status(500).json({ detail: `Failed to classify sentiment: ${error.message}` });
  }
});

// ==================== Sentiment Keywords ====================

// 현재 감성 키워드 조회
app.get('/api/sentiment/keywords', (req, res) => {
  try {
    const keywords = sentimentClassifier.getKeywords();
    res.json({
      ...keywords,
      defaults: {
        positive: DEFAULT_POSITIVE_KEYWORDS,
        negative: DEFAULT_NEGATIVE_KEYWORDS,
      }
    });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 감성 키워드 업데이트
app.put('/api/sentiment/keywords', (req, res) => {
  const { positive, negative } = req.body;

  if (!Array.isArray(positive) || !Array.isArray(negative)) {
    return res.status(400).json({ detail: 'positive and negative must be arrays of strings' });
  }

  try {
    const updated = sentimentClassifier.setKeywords(positive, negative);
    res.json({ status: 'success', ...updated });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 감성 모델 리셋 (학습 데이터 + 모델 삭제)
app.post('/api/sentiment/reset', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  try {
    const result = sentimentTrainer.resetModel();
    // 캐시도 함께 클리어
    keywordSearchCache.clear();
    semanticSearchCache.clear();
    analysisCache.clear();
    res.json({ status: 'success', ...result, cacheCleared: true });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// ==================== Sentiment Training ====================

// 수동 라벨링
app.post('/api/sentiment/label', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  const { text, label, articleId } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ detail: 'text is required' });
  }
  if (!['positive', 'negative', 'neutral'].includes(label)) {
    return res.status(400).json({ detail: 'label must be positive, negative, or neutral' });
  }

  try {
    const entry = sentimentTrainer.addLabel(text.trim(), label, articleId || null);
    res.json({ status: 'success', entry });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 일괄 수동 라벨링
app.post('/api/sentiment/label-batch', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ detail: 'items array is required' });
  }

  try {
    const results = sentimentTrainer.addLabels(items);
    res.json({ status: 'success', added: results.length, total: sentimentTrainer.labeledData.length });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// HF 모델로 자동 라벨링
app.post('/api/sentiment/auto-label', async (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  const { texts, addToTrainingData = true } = req.body;
  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ detail: 'texts array is required' });
  }
  if (texts.length > 100) {
    return res.status(400).json({ detail: 'Maximum 100 texts per request' });
  }

  try {
    const results = await sentimentTrainer.autoLabel(texts, addToTrainingData);
    res.json({
      results,
      total: results.length,
      addedToTrainingData: addToTrainingData,
    });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 분류기 학습
app.post('/api/sentiment/train', async (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  const { modelType = 'logistic_regression', testSize = 0.2, epochs = 200, lr = 0.1 } = req.body;

  try {
    console.log('[Sentiment] Training classifier...');
    const result = await sentimentTrainer.train({ modelType, testSize, epochs, lr });
    console.log(`[Sentiment] Training complete. Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
    res.json(result);
  } catch (err) {
    if (err.message.includes('최소')) {
      return res.status(400).json({ detail: err.message });
    }
    res.status(500).json({ detail: err.message });
  }
});

// 감성 예측
app.post('/api/sentiment/predict', async (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  const { texts } = req.body;
  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ detail: 'texts array is required' });
  }
  if (texts.length > 50) {
    return res.status(400).json({ detail: 'Maximum 50 texts per request' });
  }

  try {
    const predictions = await sentimentTrainer.predict(texts);
    res.json({ predictions, total: predictions.length });
  } catch (err) {
    if (err.message.includes('학습된 모델')) {
      return res.status(400).json({ detail: err.message });
    }
    res.status(500).json({ detail: err.message });
  }
});

// 통계 조회
app.get('/api/sentiment/stats', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  try {
    res.json(sentimentTrainer.getStats());
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 라벨 데이터 조회
app.get('/api/sentiment/labels', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = (page - 1) * limit;

  const data = sentimentTrainer.labeledData;
  const items = data.slice(offset, offset + limit);

  res.json({
    items,
    total: data.length,
    page,
    limit,
    totalPages: Math.ceil(data.length / limit),
  });
});

// 자동 라벨 데이터 삭제
app.delete('/api/sentiment/auto-labels', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  try {
    const result = sentimentTrainer.clearAutoLabels();
    res.json({ status: 'success', ...result });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// ==================== Sentiment Pipeline Management ====================

// 파이프라인 설정/상태 조회
app.get('/api/sentiment/pipeline', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  try {
    res.json(sentimentTrainer.getPipelineConfig());
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 파이프라인 설정 변경
app.put('/api/sentiment/pipeline', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  try {
    const updated = sentimentTrainer.setPipelineConfig(req.body);
    res.json({ status: 'success', config: updated });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 수동 재학습 트리거
app.post('/api/sentiment/pipeline/retrain', async (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  try {
    const { modelType = 'logistic_regression', testSize = 0.2, epochs = 200, lr = 0.1 } = req.body;
    console.log('[Pipeline] Manual retrain triggered');
    const result = await sentimentTrainer.train({ modelType, testSize, epochs, lr });
    sentimentTrainer._newLlmLabelsSinceRetrain = 0;
    console.log(`[Pipeline] Retrain complete. Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
    res.json({ status: 'success', ...result });
  } catch (err) {
    if (err.message.includes('최소')) {
      return res.status(400).json({ detail: err.message });
    }
    res.status(500).json({ detail: err.message });
  }
});

// LLM 라벨 전체 삭제
app.delete('/api/sentiment/llm-labels', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  try {
    const result = sentimentTrainer.clearLlmLabels();
    res.json({ status: 'success', ...result });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 주기적 재학습 cron 설정
app.post('/api/sentiment/pipeline/schedule', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  const { enabled, schedule } = req.body;

  if (enabled && !scheduler.validateCronExpression(schedule)) {
    return res.status(400).json({ detail: 'Invalid cron expression' });
  }

  try {
    const jobId = 'sentiment-auto-retrain';

    if (enabled) {
      const taskFunction = async () => {
        console.log('[Pipeline Schedule] Running scheduled retrain');
        try {
          const result = await sentimentTrainer.train();
          sentimentTrainer._newLlmLabelsSinceRetrain = 0;
          console.log(`[Pipeline Schedule] Retrain complete. Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
        } catch (err) {
          console.error(`[Pipeline Schedule] Retrain failed: ${err.message}`);
        }
      };

      const result = scheduler.addJob(jobId, schedule, { enabled, schedule }, taskFunction);
      res.json({
        status: 'success',
        jobId: result.jobId,
        nextRun: result.nextRun,
        message: 'Sentiment retrain schedule enabled',
      });
    } else {
      scheduler.removeJob(jobId);
      res.json({
        status: 'success',
        message: 'Sentiment retrain schedule disabled',
      });
    }
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 재학습 스케줄 상태 조회
app.get('/api/sentiment/pipeline/schedule', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }

  try {
    const jobs = scheduler.listJobs();
    const retrainJob = jobs.find(j => j.jobId === 'sentiment-auto-retrain');

    if (retrainJob && retrainJob.active) {
      res.json({
        enabled: true,
        ...retrainJob.config,
        lastRun: retrainJob.lastRun,
        nextRun: retrainJob.nextRun,
      });
    } else {
      res.json({ enabled: false });
    }
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 시드 데이터 자동 수집 (다양한 키워드로 학습 데이터 구축)
app.post('/api/sentiment/pipeline/seed', async (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }
  if (!llmService) {
    return res.status(503).json({ detail: 'LLM service is not available' });
  }
  if (sentimentTrainer._seedStatus.running) {
    return res.status(409).json({ detail: 'Seed already running', status: sentimentTrainer.getSeedStatus() });
  }

  const defaultKeywords = [
    // 긍정 유도
    '흥행 대박', '수상 쾌거', '신기록 달성', '호실적 성장', '인기 완판',
    // 부정 유도
    '리콜 결함', '사고 피해', '논란 비판', '해킹 유출', '적발 위반',
    // 중립 유도
    '정책 발표', '실적 발표', '인사 이동', '신제품 출시', '계획 추진',
    // 대기업 (혼합)
    '삼성전자', '현대차', '카카오', '네이버',
  ];

  const keywords = req.body.keywords || defaultKeywords;
  const numPerKeyword = Math.min(Math.max(parseInt(req.body.num) || 20, 5), 50);

  // 시드 상태 초기화
  sentimentTrainer._seedStatus = {
    running: true,
    currentKeyword: '',
    completedKeywords: 0,
    totalKeywords: keywords.length,
    labelsAdded: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  const labelsBefore = sentimentTrainer.labeledData.length;

  // 즉시 응답 (백그라운드 실행)
  res.json({
    status: 'started',
    totalKeywords: keywords.length,
    numPerKeyword,
    currentLabels: labelsBefore,
    message: `${keywords.length}개 키워드로 시드 시작. GET /api/sentiment/pipeline/seed 로 진행 상태 확인`,
  });

  // 백그라운드 실행
  (async () => {
    for (let k = 0; k < keywords.length; k++) {
      const keyword = keywords[k];
      sentimentTrainer._seedStatus.currentKeyword = keyword;

      try {
        console.log(`[Seed] (${k + 1}/${keywords.length}) Searching: "${keyword}"`);

        // 뉴스 검색
        const allArticles = await fetchFromAllSources(keyword, 'ko', 'kr', numPerKeyword, [], 50);
        const uniqueArticles = deduplicateAndFilter(allArticles, []);

        if (uniqueArticles.length === 0) {
          console.log(`[Seed] No articles found for "${keyword}", skipping`);
          sentimentTrainer._seedStatus.completedKeywords = k + 1;
          continue;
        }

        const articlesToClassify = uniqueArticles.slice(0, numPerKeyword);

        // LLM 감성 분류 (sentimentTrainer 자동 수집 포함)
        console.log(`[Seed] Classifying ${articlesToClassify.length} articles for "${keyword}"`);
        await sentimentClassifier.classifyArticlesWithLLM(
          articlesToClassify, llmService, keyword, sentimentTrainer, { forceLLM: true }
        );

        sentimentTrainer._seedStatus.completedKeywords = k + 1;
        sentimentTrainer._seedStatus.labelsAdded = sentimentTrainer.labeledData.length - labelsBefore;

        console.log(`[Seed] (${k + 1}/${keywords.length}) Done. Labels added so far: ${sentimentTrainer._seedStatus.labelsAdded}`);

        // 키워드 간 딜레이 (rate limit 방지)
        if (k < keywords.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err) {
        console.error(`[Seed] Error for "${keyword}": ${err.message}`);
      }
    }

    // 완료
    sentimentTrainer._seedStatus.running = false;
    sentimentTrainer._seedStatus.currentKeyword = '';
    sentimentTrainer._seedStatus.finishedAt = new Date().toISOString();
    sentimentTrainer._seedStatus.labelsAdded = sentimentTrainer.labeledData.length - labelsBefore;

    console.log(`[Seed] Completed. Total labels: ${sentimentTrainer.labeledData.length}, added: ${sentimentTrainer._seedStatus.labelsAdded}`);

    // 시드 완료 후 재학습
    if (sentimentTrainer.labeledData.length >= sentimentTrainer._pipelineConfig.minLabelsForTraining) {
      console.log('[Seed] Triggering retrain after seed...');
      try {
        const result = await sentimentTrainer.train();
        sentimentTrainer._newLlmLabelsSinceRetrain = 0;
        console.log(`[Seed] Retrain complete. Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
      } catch (err) {
        console.error(`[Seed] Retrain failed: ${err.message}`);
      }
    }
  })();
});

// 시드 진행 상태 조회
app.get('/api/sentiment/pipeline/seed', (req, res) => {
  if (!sentimentTrainer) {
    return res.status(503).json({ detail: 'Sentiment trainer is not available' });
  }
  res.json(sentimentTrainer.getSeedStatus());
});

// ==================== Lark Bot Endpoints ====================

// 1. 수동 Lark 전송
app.post('/api/lark/send-manual', async (req, res) => {
  const { webhookUrl, query, sentimentTypes, num = 20, excluded_sources = [] } = req.body;

  // Webhook URL 검증
  if (!larkBot.validateWebhookUrl(webhookUrl)) {
    return res.status(400).json({ detail: 'Invalid Lark webhook URL' });
  }

  // LLM 서비스 확인
  if (!llmService) {
    return res.status(503).json({ detail: 'LLM service is not available' });
  }

  try {
    console.log(`[Lark] Manual send requested for query: ${query}`);

    // 뉴스 수집
    const articles = await fetchFromAllSources(query, 'ko', 'kr', num, excluded_sources);
    const uniqueArticles = deduplicateAndFilter(articles, excluded_sources);

    if (uniqueArticles.length === 0) {
      return res.status(404).json({ detail: 'No articles found for the given query' });
    }

    console.log(`[Lark] Fetched ${uniqueArticles.length} articles`);

    // AI 분석
    const analysis = await llmService.analyzeComprehensive(query, uniqueArticles.slice(0, 20));
    console.log(`[Lark] Analysis completed`);

    // 감성 분류 (LLM 기반 개별 기사 분석 + 자동 라벨 수집)
    const classifiedArticles = await sentimentClassifier.classifyArticlesWithLLM(uniqueArticles, llmService, query, sentimentTrainer);
    console.log(`[Lark] Articles classified by sentiment (LLM-based)`);

    // 필터링
    const filteredArticles = sentimentClassifier.filterBySentiment(classifiedArticles, sentimentTypes);
    console.log(`[Lark] Filtered to ${filteredArticles.length} articles for sentiment types: ${sentimentTypes.join(', ')}`);

    if (filteredArticles.length === 0) {
      return res.status(404).json({
        detail: `No articles found with sentiment types: ${sentimentTypes.join(', ')}`
      });
    }

    // Lark 전송
    await larkBot.sendNewsDigest(webhookUrl, query, filteredArticles.slice(0, 10), analysis, sentimentTypes);
    console.log(`[Lark] Message sent successfully`);

    res.json({
      success: true,
      message: 'Lark notification sent successfully',
      articlesSent: Math.min(filteredArticles.length, 10),
      totalArticles: filteredArticles.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Lark] Send manual error:', error);
    res.status(500).json({ detail: error.message });
  }
});

// Lark 스케줄 작업 함수 (설정 저장 + 서버 시작 시 복원에서 공유)
function createLarkTaskFunction() {
  return async (config) => {
    console.log(`[Lark Schedule] Running scheduled job for query: ${config.query}`);

    try {
      // 뉴스 수집
      const articles = await fetchFromAllSources(
        config.query,
        'ko',
        'kr',
        config.num,
        config.excluded_sources
      );
      const uniqueArticles = deduplicateAndFilter(articles, config.excluded_sources);

      if (uniqueArticles.length === 0) {
        console.warn(`[Lark Schedule] No articles found for query: ${config.query}`);
        return;
      }

      // AI 분석
      const analysis = await llmService.analyzeComprehensive(config.query, uniqueArticles.slice(0, 20));

      // 감성 분류 (LLM 기반 개별 기사 분석 + 자동 라벨 수집)
      const classifiedArticles = await sentimentClassifier.classifyArticlesWithLLM(uniqueArticles, llmService, config.query, sentimentTrainer);

      // 필터링
      const filteredArticles = sentimentClassifier.filterBySentiment(
        classifiedArticles,
        config.sentimentTypes
      );

      if (filteredArticles.length === 0) {
        console.warn(`[Lark Schedule] No articles with sentiment types: ${config.sentimentTypes.join(', ')}`);
        return;
      }

      // Lark 전송
      await larkBot.sendNewsDigest(
        config.webhookUrl,
        config.query,
        filteredArticles.slice(0, 10),
        analysis,
        config.sentimentTypes
      );

      console.log(`[Lark Schedule] Message sent successfully: ${filteredArticles.length} articles`);
    } catch (error) {
      console.error(`[Lark Schedule] Job failed:`, error);
    }
  };
}

// 2. 스케줄 설정 저장
app.post('/api/lark/schedule-config', async (req, res) => {
  const { enabled, schedule, webhookUrl, query, sentimentTypes, num, excluded_sources } = req.body;

  // 항상 파일에 저장 (enabled 여부 상관없이 설정값 보존)
  saveLarkConfigToFile(req.body);

  try {
    if (enabled) {
      // 활성화 시에만 검증
      if (!scheduler.validateCronExpression(schedule)) {
        return res.status(400).json({ detail: 'Invalid cron expression' });
      }
      if (!larkBot.validateWebhookUrl(webhookUrl)) {
        return res.status(400).json({ detail: 'Invalid Lark webhook URL' });
      }
      const jobId = 'lark-news-notification';

      // 작업 추가/업데이트
      const result = scheduler.addJob(jobId, schedule, req.body, createLarkTaskFunction());

      res.json({
        success: true,
        jobId: result.jobId,
        nextRun: result.nextRun,
        message: 'Scheduled notifications enabled'
      });
    } else {
      // 비활성화
      scheduler.removeJob('lark-news-notification');
      res.json({
        success: true,
        message: 'Scheduled notifications disabled'
      });
    }
  } catch (error) {
    console.error('[Lark] Schedule config error:', error);
    res.status(500).json({ detail: error.message });
  }
});

// 3. 스케줄 설정 조회
app.get('/api/lark/schedule-config', (req, res) => {
  try {
    const jobs = scheduler.listJobs();
    const larkJob = jobs.find(j => j.jobId === 'lark-news-notification');

    if (larkJob && larkJob.active) {
      res.json({
        enabled: true,
        ...larkJob.config,
        lastRun: larkJob.lastRun,
        nextRun: larkJob.nextRun
      });
    } else {
      // 스케줄러에 없으면 파일에서 로드 (서버 재시작 후 설정값 보존)
      const savedConfig = loadLarkConfigFromFile();
      if (savedConfig) {
        res.json(savedConfig);
      } else {
        res.json({ enabled: false });
      }
    }
  } catch (error) {
    console.error('[Lark] Get schedule config error:', error);
    res.status(500).json({ detail: error.message });
  }
});

// 4. 스케줄 설정 삭제
app.delete('/api/lark/schedule-config', (req, res) => {
  try {
    const removed = scheduler.removeJob('lark-news-notification');

    // 파일도 삭제
    try {
      if (fs.existsSync(LARK_CONFIG_FILE)) {
        fs.unlinkSync(LARK_CONFIG_FILE);
      }
    } catch (e) { /* ignore */ }

    if (removed) {
      res.json({
        success: true,
        message: 'Scheduled notifications disabled'
      });
    } else {
      res.json({
        success: true,
        message: 'No scheduled notifications to remove'
      });
    }
  } catch (error) {
    console.error('[Lark] Delete schedule config error:', error);
    res.status(500).json({ detail: error.message });
  }
});

// ==================== Restore Lark Schedule on Startup ====================

(() => {
  const savedConfig = loadLarkConfigFromFile();
  if (savedConfig && savedConfig.enabled && savedConfig.schedule && savedConfig.webhookUrl) {
    try {
      if (scheduler.validateCronExpression(savedConfig.schedule)) {
        scheduler.addJob('lark-news-notification', savedConfig.schedule, savedConfig, createLarkTaskFunction());
        console.log(`[Lark] Restored scheduled job from saved config (query: "${savedConfig.query}")`);
      }
    } catch (err) {
      console.warn('[Lark] Failed to restore scheduled job:', err.message);
    }
  }
})();

// ==================== Feedback API (Phase 3) ====================

/**
 * POST /api/feedback/submit
 * Body: { articleId: string, feedback: 'like' | 'dislike' }
 */
app.post('/api/feedback/submit', (req, res) => {
  const { articleId, feedback } = req.body;
  if (!articleId || !['like', 'dislike'].includes(feedback)) {
    return res.status(400).json({ detail: "articleId and feedback ('like'|'dislike') required" });
  }
  const result = feedbackService.submit(articleId, feedback);
  res.json({ articleId, ...result });
});

/**
 * GET /api/feedback/stats
 */
app.get('/api/feedback/stats', (req, res) => {
  res.json(feedbackService.getStats());
});

/**
 * GET /api/feedback/:articleId
 */
app.get('/api/feedback/:articleId', (req, res) => {
  res.json(feedbackService.get(req.params.articleId));
});

// ==================== Start Server ====================

const PORT = parseInt(process.env.PORT || '8000', 10);
const server = app.listen(PORT, () => {
  console.log(`News Crawler API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// LLM 분석 등 장시간 요청을 위한 서버 타임아웃 설정 (5분)
server.timeout = 300000;
server.keepAliveTimeout = 300000;
server.headersTimeout = 310000;
