import httpx
from typing import Optional
from datetime import datetime
from app.models import NewsArticle
from app.utils.id_generator import generate_news_id
from app.utils.date_parser import parse_published_date


class NaverNewsService:
    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.base_url = "https://openapi.naver.com/v1/search/news.json"

    async def search_news(
        self,
        query: str,
        display: int = 100,
        start: int = 1,
        sort: str = "date"
    ) -> list[NewsArticle]:
        """
        Search news using Naver Search API.

        Args:
            query: Search query
            display: Number of results (max 100)
            start: Start position (1-1000)
            sort: 'date' (latest) or 'sim' (accuracy)
        """
        articles = []

        # Naver API allows up to 1000 results, 100 per request
        max_results = min(display, 1000)
        results_per_page = 100
        pages_needed = (max_results + results_per_page - 1) // results_per_page

        headers = {
            "X-Naver-Client-Id": self.client_id,
            "X-Naver-Client-Secret": self.client_secret
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            for page in range(pages_needed):
                current_start = start + (page * results_per_page)
                current_display = min(results_per_page, max_results - len(articles))

                if current_display <= 0:
                    break

                params = {
                    "query": query,
                    "display": current_display,
                    "start": current_start,
                    "sort": sort
                }

                try:
                    response = await client.get(
                        self.base_url,
                        headers=headers,
                        params=params
                    )
                    response.raise_for_status()
                    data = response.json()
                except httpx.HTTPError as e:
                    if page > 0:
                        break
                    raise Exception(f"Naver API request failed: {str(e)}")

                items = data.get("items", [])

                if not items:
                    break

                for item in items:
                    article = self._parse_news_item(item)
                    if article:
                        articles.append(article)

        return articles

    def _parse_news_item(self, item: dict) -> Optional[NewsArticle]:
        """Parse a single news item from Naver API response."""
        try:
            import html

            # Clean HTML tags and entities
            title = html.unescape(item.get("title", ""))
            title = title.replace("<b>", "").replace("</b>", "")

            description = html.unescape(item.get("description", ""))
            description = description.replace("<b>", "").replace("</b>", "")

            url = item.get("link", "")

            if not title or not url:
                return None

            # Generate ID
            article_id = generate_news_id(url, title)

            # Parse date (Naver returns RFC2822 format)
            date_str = item.get("pubDate", "")
            published_at = parse_published_date(date_str, "naver")

            return NewsArticle(
                id=article_id,
                title=title,
                url=url,
                source="naver",
                publishedAt=published_at,
                snippet=description if description else None,
                thumbnail=None
            )
        except Exception:
            return None
