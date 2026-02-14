import httpx
from datetime import datetime
from typing import Optional
from app.models import NewsArticle
from app.utils.id_generator import generate_news_id
from app.utils.date_parser import parse_published_date


class NewsCrawler:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://serpapi.com/search.json"

    async def search_news(
        self,
        query: str,
        language: str = "ko",
        country: str = "kr",
        num: int = 100
    ) -> list[NewsArticle]:
        """
        Search news using SerpAPI Google News engine.
        Supports fetching more than 100 results by making multiple paginated requests.
        num: Total number of results to return (will make multiple API calls if > 100)
        """
        all_articles = []
        per_page = 100  # SerpAPI limit per request
        pages_needed = (num + per_page - 1) // per_page  # Ceiling division

        async with httpx.AsyncClient(timeout=30.0) as client:
            for page in range(pages_needed):
                start = page * per_page
                current_num = min(per_page, num - start)

                if current_num <= 0:
                    break

                params = {
                    "engine": "google_news",
                    "q": query,
                    "hl": language,
                    "gl": country,
                    "num": current_num,
                    "start": start,
                    "api_key": self.api_key
                }

                try:
                    response = await client.get(self.base_url, params=params)
                    response.raise_for_status()
                    data = response.json()
                except httpx.HTTPError as e:
                    # If pagination fails, return what we have so far
                    if page > 0:
                        break
                    raise Exception(f"SerpAPI request failed: {str(e)}")

                # Extract news_results array
                news_results = data.get("news_results", [])

                # If no more results, stop fetching
                if not news_results:
                    break

                for item in news_results:
                    article = self._parse_news_item(item)
                    if article:
                        all_articles.append(article)

        # Remove duplicates based on ID
        seen_ids = set()
        unique_articles = []
        for article in all_articles:
            if article.id not in seen_ids:
                seen_ids.add(article.id)
                unique_articles.append(article)

        # Sort by publishedAt (None values go to the back)
        from datetime import timezone
        def get_sort_key(article):
            if article.publishedAt:
                if article.publishedAt.tzinfo is None:
                    return article.publishedAt.replace(tzinfo=timezone.utc)
                return article.publishedAt
            return datetime(1970, 1, 1, tzinfo=timezone.utc)

        unique_articles.sort(key=get_sort_key, reverse=True)

        return unique_articles

    def _parse_news_item(self, item: dict) -> Optional[NewsArticle]:
        """Parse a single news item from SerpAPI response."""
        try:
            title = item.get("title", "")
            url = item.get("link", "")

            if not title or not url:
                return None

            # Generate ID
            article_id = generate_news_id(url, title)

            # Parse date - try multiple possible field names
            date_str = item.get("date") or item.get("time") or item.get("published") or ""

            # Extract source name
            source_info = item.get("source", {})
            if isinstance(source_info, dict):
                source_name = source_info.get("name", "google")
            else:
                source_name = str(source_info) if source_info else "google"

            # Parse published date
            published_at = None
            if date_str:
                published_at = parse_published_date(date_str, source_name)

            return NewsArticle(
                id=article_id,
                title=title,
                url=url,
                source=source_name,
                publishedAt=published_at,
                snippet=item.get("snippet"),
                thumbnail=item.get("thumbnail")
            )
        except Exception:
            return None
