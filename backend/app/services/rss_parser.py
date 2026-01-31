import feedparser
import httpx
from typing import Optional
from datetime import datetime
from app.models import NewsArticle
from app.utils.id_generator import generate_news_id
from app.utils.date_parser import parse_published_date


class RSSParser:
    # 주요 한국 뉴스 RSS 피드
    RSS_FEEDS = {
        "연합뉴스": "https://www.yonhapnewstv.co.kr/category/news/headline/feed/",
        "KBS": "https://news.kbs.co.kr/rss/headline.xml",
        "MBC": "https://imnews.imbc.com/rss/news/news_00.xml",
        "SBS": "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01",
        "JTBC": "https://fs.jtbc.co.kr/RSS/newsflash.xml",
    }

    async def search_news(self, query: str, max_per_feed: int = 50) -> list[NewsArticle]:
        """
        Search news from multiple RSS feeds.
        Filters results by query keyword.
        """
        all_articles = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            for source_name, feed_url in self.RSS_FEEDS.items():
                try:
                    articles = await self._fetch_feed(
                        client,
                        feed_url,
                        source_name,
                        query,
                        max_per_feed
                    )
                    all_articles.extend(articles)
                except Exception:
                    # Skip failed feeds
                    continue

        return all_articles

    async def _fetch_feed(
        self,
        client: httpx.AsyncClient,
        feed_url: str,
        source_name: str,
        query: str,
        max_results: int
    ) -> list[NewsArticle]:
        """Fetch and parse a single RSS feed."""
        try:
            response = await client.get(feed_url)
            response.raise_for_status()

            # Parse RSS feed
            feed = feedparser.parse(response.text)

            articles = []
            query_lower = query.lower()

            for entry in feed.entries[:max_results * 2]:  # Fetch more, then filter
                # Filter by query keyword in title or description
                title = entry.get("title", "")
                description = entry.get("description", "") or entry.get("summary", "")

                if query_lower not in title.lower() and query_lower not in description.lower():
                    continue

                article = self._parse_entry(entry, source_name)
                if article:
                    articles.append(article)

                if len(articles) >= max_results:
                    break

            return articles
        except Exception:
            return []

    def _parse_entry(self, entry: dict, source_name: str) -> Optional[NewsArticle]:
        """Parse a single RSS entry."""
        try:
            title = entry.get("title", "")
            url = entry.get("link", "")

            if not title or not url:
                return None

            # Generate ID
            article_id = generate_news_id(url, title)

            # Parse date
            date_str = entry.get("published", "") or entry.get("pubDate", "")
            published_at = parse_published_date(date_str, source_name)

            # Get description/summary
            description = entry.get("description", "") or entry.get("summary", "")

            # Remove HTML tags from description
            if description:
                from bs4 import BeautifulSoup
                description = BeautifulSoup(description, "html.parser").get_text()
                description = description.strip()[:500]  # Limit length

            return NewsArticle(
                id=article_id,
                title=title,
                url=url,
                source=source_name,
                publishedAt=published_at,
                snippet=description if description else None,
                thumbnail=None
            )
        except Exception:
            return None
