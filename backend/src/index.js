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

const { DaumNewsService } = require('./services/daumNews');
const daumService = new DaumNewsService();

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
const { ArticleSentimentClassifier } = require('./services/articleSentimentClassifier');
const sentimentClassifier = new ArticleSentimentClassifier();

// Lark Bot Service
const { LarkBotService } = require('./services/larkBot');
const larkBot = new LarkBotService();

// Scheduler Service
const { SchedulerService } = require('./services/schedulerService');
const scheduler = new SchedulerService();

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

  // 3. Daum News (scraping) - parallel batch, up to 1000
  if (!excludedSources.includes('daum')) {
    tasks.push(daumService.searchNews(q, Math.min(num, 1000)));
  } else {
    console.log('[DEBUG] Skipping Daum News (excluded)');
  }

  // 4. RSS Feeds (Korean: no filter, International: keyword filter)
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
    const allArticles = await fetchFromAllSources(q, hl, gl, num, excluded_sources, 100);
    console.log(`[DEBUG] Keyword search - Fetched ${allArticles.length} articles total`);

    const uniqueArticles = deduplicateAndFilter(allArticles, excluded_sources);
    console.log(`[DEBUG] Keyword search - After deduplication: ${uniqueArticles.length} unique articles`);

    sortByDate(uniqueArticles);

    // Limit to requested number of articles
    const limitedArticles = uniqueArticles.slice(0, num);

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
    const allArticles = await fetchFromAllSources(q, hl, gl, num, excluded_sources, 100);
    console.log(`[DEBUG] Fetched ${allArticles.length} articles total`);

    const uniqueArticles = deduplicateAndFilter(allArticles, excluded_sources);
    console.log(`[DEBUG] After deduplication: ${uniqueArticles.length} unique articles`);

    // Rank by semantic similarity
    const rankedResults = embeddingService.rankArticlesBySimilarity(
      q, uniqueArticles, minSimilarity, num * 2
    );

    console.log(`[DEBUG] After semantic filtering (min_similarity=${minSimilarity}): ${rankedResults.length} articles`);

    // Limit to requested number of articles
    const limitedResults = rankedResults.slice(0, num);

    const articlesWithScores = limitedResults.map(({ article, score }) => ({
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

// ==================== Sentiment Classification ====================

// LLM 기반 감성 분류
app.post('/api/news/classify-sentiment', async (req, res) => {
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

    // LLM 기반 감성 분류
    const classifiedArticles = await sentimentClassifier.classifyArticlesWithLLM(
      articles,
      llmService,
      query
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
    console.error('[Sentiment] Classification error:', error);
    res.status(500).json({ detail: `Failed to classify sentiment: ${error.message}` });
  }
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

    // 감성 분류 (LLM 기반 개별 기사 분석)
    const classifiedArticles = await sentimentClassifier.classifyArticlesWithLLM(uniqueArticles, llmService, query);
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

// 2. 스케줄 설정 저장
app.post('/api/lark/schedule-config', async (req, res) => {
  const { enabled, schedule, webhookUrl, query, sentimentTypes, num, excluded_sources } = req.body;

  // 스케줄 검증
  if (!scheduler.validateCronExpression(schedule)) {
    return res.status(400).json({ detail: 'Invalid cron expression' });
  }

  // Webhook URL 검증
  if (!larkBot.validateWebhookUrl(webhookUrl)) {
    return res.status(400).json({ detail: 'Invalid Lark webhook URL' });
  }

  try {
    if (enabled) {
      const jobId = 'lark-news-notification';

      // 스케줄 작업 함수
      const taskFunction = async (config) => {
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

          // 감성 분류 (LLM 기반 개별 기사 분석)
          const classifiedArticles = await sentimentClassifier.classifyArticlesWithLLM(uniqueArticles, llmService, config.query);

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

      // 작업 추가/업데이트
      const result = scheduler.addJob(jobId, schedule, req.body, taskFunction);

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
      res.json({ enabled: false });
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

// ==================== Start Server ====================

const PORT = parseInt(process.env.PORT || '8000', 10);
app.listen(PORT, () => {
  console.log(`News Crawler API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
