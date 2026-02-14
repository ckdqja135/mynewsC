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
        # 한국 언론사
        "연합뉴스": "https://www.yonhapnewstv.co.kr/category/news/headline/feed/",
        "KBS": "https://news.kbs.co.kr/rss/headline.xml",
        "MBC": "https://imnews.imbc.com/rss/news/news_00.xml",
        "SBS": "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01",
        "JTBC": "https://fs.jtbc.co.kr/RSS/newsflash.xml",

        # CNN
        "CNN": "http://rss.cnn.com/rss/edition.rss",
        "CNN World": "http://rss.cnn.com/rss/edition_world.rss",
        "CNN US": "http://rss.cnn.com/rss/edition_us.rss",
        "CNN Tech": "http://rss.cnn.com/rss/edition_technology.rss",

        # BBC
        "BBC World": "http://feeds.bbci.co.uk/news/world/rss.xml",
        "BBC Business": "http://feeds.bbci.co.uk/news/business/rss.xml",
        "BBC Tech": "http://feeds.bbci.co.uk/news/technology/rss.xml",
        "BBC Science": "http://feeds.bbci.co.uk/news/science_and_environment/rss.xml",

        # Reuters
        "Reuters": "https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best",
        "Reuters World": "https://www.reuters.com/rssFeed/worldNews",
        "Reuters Business": "https://www.reuters.com/rssFeed/businessNews",
        "Reuters Tech": "https://www.reuters.com/rssFeed/technologyNews",

        # AP News
        "AP News": "https://rsshub.app/apnews/topics/apf-topnews",

        # New York Times
        "NYTimes World": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
        "NYTimes US": "https://rss.nytimes.com/services/xml/rss/nyt/US.xml",
        "NYTimes Tech": "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
        "NYTimes Business": "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",

        # Washington Post
        "Washington Post": "https://feeds.washingtonpost.com/rss/world",

        # Wall Street Journal
        "WSJ": "https://feeds.a.dj.com/rss/RSSWorldNews.xml",
        "WSJ Tech": "https://feeds.a.dj.com/rss/RSSWSJD.xml",

        # USA Today
        "USA Today": "http://rssfeeds.usatoday.com/usatoday-NewsTopStories",

        # NPR
        "NPR": "https://feeds.npr.org/1001/rss.xml",

        # The Guardian
        "The Guardian": "https://www.theguardian.com/world/rss",
        "The Guardian Tech": "https://www.theguardian.com/technology/rss",

        # Bloomberg
        "Bloomberg": "https://www.bloomberg.com/feeds/sitemap_news.xml",

        # Forbes
        "Forbes": "https://www.forbes.com/real-time/feed2/",

        # Time
        "Time": "https://time.com/feed/",

        # Politico
        "Politico": "https://www.politico.com/rss/politics08.xml",

        # ABC News
        "ABC News": "https://abcnews.go.com/abcnews/topstories",

        # CBS News
        "CBS News": "https://www.cbsnews.com/latest/rss/main",
    }

    async def search_news(self, query: str, max_per_feed: int = 50, excluded_sources: list[str] = None) -> list[NewsArticle]:
        """
        Search news from multiple RSS feeds.
        Filters results by query keyword.

        Args:
            query: Search query
            max_per_feed: Maximum results per feed
            excluded_sources: List of source names to exclude from crawling
        """
        all_articles = []
        excluded_sources = excluded_sources or []

        async with httpx.AsyncClient(timeout=15.0) as client:
            for source_name, feed_url in self.RSS_FEEDS.items():
                # Skip excluded sources
                if source_name in excluded_sources:
                    print(f"[RSS] Skipping excluded source: {source_name}")
                    continue
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
