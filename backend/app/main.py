from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

from app.models import (
    NewsSearchRequest,
    NewsSearchResponse,
    SemanticSearchRequest,
    SemanticSearchResponse,
    NewsArticleWithScore,
    NewsAnalysisRequest,
    NewsAnalysisResponse
)
from app.services.news_crawler import NewsCrawler
from app.middleware.rate_limit import RateLimitMiddleware

load_dotenv()

app = FastAPI(
    title="News Crawler API",
    description="News aggregation API using SerpAPI",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발 환경에서 모든 origin 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting
rate_limit = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))
app.add_middleware(RateLimitMiddleware, requests_per_minute=rate_limit)

# Initialize services
SERPAPI_KEY = os.getenv("SERPAPI_KEY")
NAVER_CLIENT_ID = os.getenv("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET")

if not SERPAPI_KEY:
    raise ValueError("SERPAPI_KEY environment variable is required")

crawler = NewsCrawler(api_key=SERPAPI_KEY)

# Optional: Naver API
naver_service = None
if NAVER_CLIENT_ID and NAVER_CLIENT_SECRET:
    from app.services.naver_news import NaverNewsService
    naver_service = NaverNewsService(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)

# RSS Parser (always available)
from app.services.rss_parser import RSSParser
rss_parser = RSSParser()

# Embedding Service (for semantic search)
embedding_service = None
try:
    from app.services.embedding_service import get_embedding_service
    embedding_service = get_embedding_service()
except Exception as e:
    import logging
    logging.warning(f"Failed to initialize embedding service: {str(e)}")
    logging.warning("Semantic search will not be available")

# LLM Service (for news analysis)
llm_service = None
try:
    from app.services.llm_service import get_llm_service
    llm_service = get_llm_service()
except Exception as e:
    import logging
    logging.warning(f"Failed to initialize LLM service: {str(e)}")
    logging.warning("News analysis will not be available")


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/api/news/search", response_model=NewsSearchResponse)
async def search_news(request: NewsSearchRequest):
    """
    Search news articles from multiple sources:
    - Google News (via SerpAPI)
    - Naver News API (if configured)
    - RSS Feeds (KBS, MBC, SBS, JTBC, 연합뉴스)

    - **q**: Search query (required, 1-200 characters)
    - **hl**: Language code (default: ko)
    - **gl**: Country code (default: kr)
    - **num**: Number of results (max 500)
    """
    try:
        import asyncio

        # Fetch from all sources concurrently
        tasks = []

        # 1. Google News (SerpAPI) - limit to 100
        tasks.append(crawler.search_news(
            query=request.q,
            language=request.hl,
            country=request.gl,
            num=min(request.num, 100)
        ))

        # 2. Naver API (if available) - up to 1000
        if naver_service:
            tasks.append(naver_service.search_news(
                query=request.q,
                display=min(request.num, 1000)
            ))

        # 3. RSS Feeds
        tasks.append(rss_parser.search_news(
            query=request.q,
            max_per_feed=50
        ))

        # Wait for all sources
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Combine results
        all_articles = []
        for result in results:
            if isinstance(result, list):
                all_articles.extend(result)

        print(f"[DEBUG] Keyword search - Fetched {len(all_articles)} articles total")

        # Remove duplicates by ID
        seen_ids = set()
        unique_articles = []
        for article in all_articles:
            if article.id not in seen_ids:
                seen_ids.add(article.id)
                unique_articles.append(article)

        print(f"[DEBUG] Keyword search - After deduplication: {len(unique_articles)} unique articles")

        # Sort by date (newest first)
        # Use a very old date for articles without publishedAt
        from datetime import datetime, timezone
        def get_sort_key(article):
            if article.publishedAt:
                # Make sure datetime is aware (has timezone)
                if article.publishedAt.tzinfo is None:
                    return article.publishedAt.replace(tzinfo=timezone.utc)
                return article.publishedAt
            # Return a very old date for None values
            return datetime(1970, 1, 1, tzinfo=timezone.utc)

        unique_articles.sort(key=get_sort_key, reverse=True)

        return NewsSearchResponse(
            articles=unique_articles,
            total=len(unique_articles),
            query=request.q
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch news: {str(e)}"
        )


@app.post("/api/news/semantic-search", response_model=SemanticSearchResponse)
async def semantic_search_news(request: SemanticSearchRequest):
    """
    Semantic search for news articles using FAISS vector search for ultra-fast similarity matching.
    Returns articles ranked by semantic similarity to the query.

    - **q**: Search query (required, 1-200 characters)
    - **hl**: Language code (default: ko)
    - **gl**: Country code (default: kr)
    - **num**: Number of results (max 500)
    - **min_similarity**: Minimum similarity threshold 0-1 (default: 0.0)
    - **chunk_size**: [DEPRECATED] No longer used with FAISS
    - **early_stop_threshold**: [DEPRECATED] No longer used with FAISS

    FAISS Performance Benefits:
    - Embeddings are cached - computed only once per article
    - Vector search is 10-100x faster than computing all similarities
    - Index is persisted to disk - survives server restarts
    - Scales to millions of articles

    This endpoint:
    1. Fetches news from all sources (Google News, Naver, RSS)
    2. Adds new articles to FAISS index (cached articles are skipped)
    3. Performs ultra-fast vector search using FAISS
    4. Filters by minimum similarity threshold
    5. Returns results sorted by similarity score (highest first)
    """
    if not embedding_service:
        raise HTTPException(
            status_code=503,
            detail="Semantic search is not available. Embedding service failed to initialize."
        )

    try:
        import asyncio

        # Fetch from all sources concurrently (same as regular search)
        tasks = []

        # 1. Google News (SerpAPI) - limit to 100
        tasks.append(crawler.search_news(
            query=request.q,
            language=request.hl,
            country=request.gl,
            num=min(request.num, 100)
        ))

        # 2. Naver API (if available) - up to 1000
        if naver_service:
            tasks.append(naver_service.search_news(
                query=request.q,
                display=min(request.num, 1000)
            ))

        # 3. RSS Feeds
        tasks.append(rss_parser.search_news(
            query=request.q,
            max_per_feed=50
        ))

        # Wait for all sources
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Combine results
        all_articles = []
        for result in results:
            if isinstance(result, list):
                all_articles.extend(result)

        print(f"[DEBUG] Fetched {len(all_articles)} articles total")

        # Remove duplicates by ID
        seen_ids = set()
        unique_articles = []
        for article in all_articles:
            if article.id not in seen_ids:
                seen_ids.add(article.id)
                unique_articles.append(article)

        print(f"[DEBUG] After deduplication: {len(unique_articles)} unique articles")

        # Rank articles by semantic similarity using FAISS for ultra-fast search
        ranked_results = embedding_service.rank_articles_by_similarity_faiss(
            query=request.q,
            articles=unique_articles,
            min_similarity=request.min_similarity,
            max_results=request.num * 2  # Get up to 2x requested for better quality pool
        )

        print(f"[DEBUG] After semantic filtering (min_similarity={request.min_similarity}): {len(ranked_results)} articles")

        # Convert to NewsArticleWithScore
        articles_with_scores = [
            NewsArticleWithScore(
                id=article.id,
                title=article.title,
                url=article.url,
                source=article.source,
                publishedAt=article.publishedAt,
                snippet=article.snippet,
                thumbnail=article.thumbnail,
                similarity_score=score
            )
            for article, score in ranked_results
        ]

        return SemanticSearchResponse(
            articles=articles_with_scores,
            total=len(articles_with_scores),
            query=request.q
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to perform semantic search: {str(e)}"
        )


@app.get("/")
async def root():
    return {
        "message": "News Crawler API",
        "docs": "/docs",
        "health": "/health"
    }


@app.get("/api/news/debug")
async def debug_serpapi(q: str = "test"):
    """
    Debug endpoint to see raw SerpAPI response.
    Use: /api/news/debug?q=티니핑
    """
    import httpx

    params = {
        "engine": "google_news",
        "q": q,
        "hl": "ko",
        "gl": "kr",
        "api_key": SERPAPI_KEY
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get("https://serpapi.com/search.json", params=params)
            response.raise_for_status()
            data = response.json()

            # Return first item to see structure
            news_results = data.get("news_results", [])
            if news_results:
                return {
                    "total_results": len(news_results),
                    "first_item": news_results[0],
                    "first_item_keys": list(news_results[0].keys())
                }
            return {"error": "No results found"}
        except Exception as e:
            return {"error": str(e)}


@app.post("/api/news/analyze", response_model=NewsAnalysisResponse)
async def analyze_news(request: NewsAnalysisRequest):
    """
    Analyze news articles using Cerebras LLM for insights and trends.

    - **q**: Search query (required, 1-200 characters)
    - **hl**: Language code (default: ko)
    - **gl**: Country code (default: kr)
    - **num**: Number of articles to analyze (max 100, default 20)
    - **analysis_type**: Type of analysis
        - "comprehensive": Full analysis with sentiment, trends, and key points
        - "sentiment": Sentiment analysis only
        - "trend": Trend and pattern analysis only
        - "key_points": Extract key points only

    Returns:
    - **summary**: Overall summary of the analysis
    - **key_points**: List of key insights
    - **sentiment**: Sentiment analysis (if requested)
    - **trends**: Trend analysis (if requested)
    """
    if not llm_service:
        raise HTTPException(
            status_code=503,
            detail="News analysis is not available. LLM service failed to initialize."
        )

    try:
        import asyncio

        # Fetch from all sources concurrently
        tasks = []

        # 1. Google News (SerpAPI)
        tasks.append(crawler.search_news(
            query=request.q,
            language=request.hl,
            country=request.gl,
            num=min(request.num, 100)
        ))

        # 2. Naver API (if available)
        if naver_service:
            tasks.append(naver_service.search_news(
                query=request.q,
                display=min(request.num, 100)
            ))

        # 3. RSS Feeds
        tasks.append(rss_parser.search_news(
            query=request.q,
            max_per_feed=30
        ))

        # Wait for all sources
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Combine results
        all_articles = []
        for result in results:
            if isinstance(result, list):
                all_articles.extend(result)

        print(f"[DEBUG] Analysis - Fetched {len(all_articles)} articles total")

        # Remove duplicates
        seen_ids = set()
        unique_articles = []
        for article in all_articles:
            if article.id not in seen_ids:
                seen_ids.add(article.id)
                unique_articles.append(article)

        print(f"[DEBUG] Analysis - After deduplication: {len(unique_articles)} unique articles")

        if not unique_articles:
            raise HTTPException(
                status_code=404,
                detail="No articles found for the given query"
            )

        # Filter by date (last N days)
        from datetime import datetime, timezone, timedelta
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=request.days_back)

        def get_sort_key(article):
            if article.publishedAt:
                if article.publishedAt.tzinfo is None:
                    return article.publishedAt.replace(tzinfo=timezone.utc)
                return article.publishedAt
            return datetime(1970, 1, 1, tzinfo=timezone.utc)

        # Filter articles within date range
        filtered_articles = []
        for article in unique_articles:
            article_date = get_sort_key(article)
            if article_date >= cutoff_date:
                filtered_articles.append(article)

        print(f"[DEBUG] Analysis - After date filtering (last {request.days_back} days): {len(filtered_articles)} articles")

        if not filtered_articles:
            raise HTTPException(
                status_code=404,
                detail=f"No articles found in the last {request.days_back} days for the given query"
            )

        # Sort by date (newest first)
        filtered_articles.sort(key=get_sort_key, reverse=True)

        # Limit to requested number
        articles_to_analyze = filtered_articles[:request.num]

        # Perform analysis based on type
        if request.analysis_type == "comprehensive":
            analysis_result = await llm_service.analyze_comprehensive(
                query=request.q,
                articles=articles_to_analyze
            )
        elif request.analysis_type == "sentiment":
            analysis_result = await llm_service.analyze_sentiment(
                query=request.q,
                articles=articles_to_analyze
            )
        elif request.analysis_type == "trend":
            analysis_result = await llm_service.analyze_trends(
                query=request.q,
                articles=articles_to_analyze
            )
        elif request.analysis_type == "key_points":
            analysis_result = await llm_service.extract_key_points(
                query=request.q,
                articles=articles_to_analyze
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid analysis_type: {request.analysis_type}"
            )

        print(f"[DEBUG] Analysis completed: {request.analysis_type}")
        return analysis_result

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to analyze news: {str(e)}"
        )
