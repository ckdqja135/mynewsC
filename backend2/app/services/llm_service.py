"""
Cerebras LLM Service for News Analysis
Uses Cerebras API (OpenAI-compatible) for fast inference
"""
from openai import OpenAI
import os
import json
from typing import List
from app.models import (
    NewsArticle,
    NewsAnalysisResponse,
    SentimentAnalysis,
    TrendAnalysis
)


class CerebrasLLMService:
    def __init__(self, api_key: str):
        """Initialize Cerebras LLM service with API key"""
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.cerebras.ai/v1"
        )
        # Cerebras models: llama3.1-8b, llama3.3-70b
        self.model = "llama3.1-8b"  # Use 8b for stable, fast analysis

    def _prepare_articles_context(self, articles: List[NewsArticle], max_articles: int = 20) -> str:
        """Prepare articles as context for LLM"""
        context_parts = []

        for idx, article in enumerate(articles[:max_articles], 1):
            # Limit snippet length to avoid token limits
            snippet = article.snippet or 'No content available'
            if len(snippet) > 150:
                snippet = snippet[:150] + "..."

            article_text = f"""
[Article {idx}]
Title: {article.title}
Source: {article.source}
Date: {article.publishedAt.strftime('%Y-%m-%d') if article.publishedAt else 'Unknown'}
Content: {snippet}
"""
            context_parts.append(article_text.strip())

        return "\n\n".join(context_parts)

    async def analyze_comprehensive(self, query: str, articles: List[NewsArticle]) -> NewsAnalysisResponse:
        """Comprehensive analysis including sentiment, trends, and key points"""
        context = self._prepare_articles_context(articles)

        # Get date range
        dates = [a.publishedAt for a in articles if a.publishedAt]
        date_range = ""
        if dates:
            earliest = min(dates).strftime('%Y-%m-%d')
            latest = max(dates).strftime('%Y-%m-%d')
            date_range = f" (Articles from {earliest} to {latest})"

        prompt = f"""You are a professional news analyst. Analyze the following news articles about "{query}"{date_range} and provide a comprehensive analysis.

{context}

IMPORTANT: Respond in Korean (한국어로 응답해주세요). All text fields should be in Korean.

Please provide a detailed analysis in the following JSON format:
{{
    "summary": "A concise 2-3 sentence summary of what's happening with {query}",
    "key_points": ["Key point 1", "Key point 2", "Key point 3", ...],
    "sentiment": {{
        "overall_sentiment": "positive/negative/neutral",
        "sentiment_score": 0.0,
        "positive_aspects": ["aspect 1", "aspect 2", ...],
        "negative_aspects": ["aspect 1", "aspect 2", ...]
    }},
    "trends": {{
        "main_topics": ["topic 1", "topic 2", ...],
        "emerging_trends": ["trend 1", "trend 2", ...],
        "key_entities": ["entity 1", "entity 2", ...]
    }}
}}

Respond ONLY with valid JSON. No additional text."""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "You are a professional news analyst. Always respond in Korean (한국어) and in valid JSON format only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=2000
        )

        result_text = response.choices[0].message.content.strip()

        # Parse JSON response
        try:
            # Remove markdown code blocks if present
            if result_text.startswith("```"):
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
                result_text = result_text.strip()

            result = json.loads(result_text)

            return NewsAnalysisResponse(
                query=query,
                analysis_type="comprehensive",
                articles_analyzed=len(articles),
                summary=result.get("summary", ""),
                key_points=result.get("key_points", []),
                sentiment=SentimentAnalysis(**result.get("sentiment", {})),
                trends=TrendAnalysis(**result.get("trends", {}))
            )
        except json.JSONDecodeError as e:
            # Fallback if JSON parsing fails
            return NewsAnalysisResponse(
                query=query,
                analysis_type="comprehensive",
                articles_analyzed=len(articles),
                summary=result_text[:500],  # Use first 500 chars as summary
                key_points=["Analysis completed but format error occurred"],
                sentiment=None,
                trends=None
            )

    async def analyze_sentiment(self, query: str, articles: List[NewsArticle]) -> NewsAnalysisResponse:
        """Sentiment-focused analysis"""
        context = self._prepare_articles_context(articles)

        prompt = f"""You are a professional sentiment analyst. Analyze the sentiment in news articles about "{query}".

{context}

IMPORTANT: Respond in Korean (한국어로 응답해주세요). All text fields should be in Korean.

Provide a sentiment analysis in the following JSON format:
{{
    "summary": "Brief summary of overall sentiment",
    "key_points": ["Key sentiment insight 1", "Key sentiment insight 2", ...],
    "sentiment": {{
        "overall_sentiment": "positive/negative/neutral",
        "sentiment_score": 0.0,
        "positive_aspects": ["positive aspect 1", "positive aspect 2", ...],
        "negative_aspects": ["negative aspect 1", "negative aspect 2", ...]
    }}
}}

Sentiment score should be from -1.0 (very negative) to 1.0 (very positive).
Respond ONLY with valid JSON."""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "You are a professional sentiment analyst. Always respond in Korean (한국어) and in valid JSON format only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=1500
        )

        result_text = response.choices[0].message.content.strip()

        try:
            if result_text.startswith("```"):
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
                result_text = result_text.strip()

            result = json.loads(result_text)

            return NewsAnalysisResponse(
                query=query,
                analysis_type="sentiment",
                articles_analyzed=len(articles),
                summary=result.get("summary", ""),
                key_points=result.get("key_points", []),
                sentiment=SentimentAnalysis(**result.get("sentiment", {})),
                trends=None
            )
        except json.JSONDecodeError:
            return NewsAnalysisResponse(
                query=query,
                analysis_type="sentiment",
                articles_analyzed=len(articles),
                summary=result_text[:500],
                key_points=["Sentiment analysis completed"],
                sentiment=None,
                trends=None
            )

    async def analyze_trends(self, query: str, articles: List[NewsArticle]) -> NewsAnalysisResponse:
        """Trend-focused analysis"""
        context = self._prepare_articles_context(articles)

        prompt = f"""You are a professional trend analyst. Identify trends and patterns in news articles about "{query}".

{context}

IMPORTANT: Respond in Korean (한국어로 응답해주세요). All text fields should be in Korean.

Provide a trend analysis in the following JSON format:
{{
    "summary": "Brief summary of main trends",
    "key_points": ["Key trend 1", "Key trend 2", ...],
    "trends": {{
        "main_topics": ["topic 1", "topic 2", ...],
        "emerging_trends": ["emerging trend 1", "emerging trend 2", ...],
        "key_entities": ["person/org 1", "person/org 2", ...]
    }}
}}

Respond ONLY with valid JSON."""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "You are a professional trend analyst. Always respond in Korean (한국어) and in valid JSON format only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=1500
        )

        result_text = response.choices[0].message.content.strip()

        try:
            if result_text.startswith("```"):
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
                result_text = result_text.strip()

            result = json.loads(result_text)

            return NewsAnalysisResponse(
                query=query,
                analysis_type="trend",
                articles_analyzed=len(articles),
                summary=result.get("summary", ""),
                key_points=result.get("key_points", []),
                sentiment=None,
                trends=TrendAnalysis(**result.get("trends", {}))
            )
        except json.JSONDecodeError:
            return NewsAnalysisResponse(
                query=query,
                analysis_type="trend",
                articles_analyzed=len(articles),
                summary=result_text[:500],
                key_points=["Trend analysis completed"],
                sentiment=None,
                trends=None
            )

    async def extract_key_points(self, query: str, articles: List[NewsArticle]) -> NewsAnalysisResponse:
        """Extract key points and insights"""
        context = self._prepare_articles_context(articles)

        prompt = f"""You are a professional news summarizer. Extract the most important key points from news articles about "{query}".

{context}

IMPORTANT: Respond in Korean (한국어로 응답해주세요). All text fields should be in Korean.

Provide key points in the following JSON format:
{{
    "summary": "One sentence summary of the most important information",
    "key_points": ["Key point 1", "Key point 2", "Key point 3", ...]
}}

Focus on factual, actionable information. Respond ONLY with valid JSON."""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "You are a professional news summarizer. Always respond in Korean (한국어) and in valid JSON format only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=1000
        )

        result_text = response.choices[0].message.content.strip()

        try:
            if result_text.startswith("```"):
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
                result_text = result_text.strip()

            result = json.loads(result_text)

            return NewsAnalysisResponse(
                query=query,
                analysis_type="key_points",
                articles_analyzed=len(articles),
                summary=result.get("summary", ""),
                key_points=result.get("key_points", []),
                sentiment=None,
                trends=None
            )
        except json.JSONDecodeError:
            return NewsAnalysisResponse(
                query=query,
                analysis_type="key_points",
                articles_analyzed=len(articles),
                summary=result_text[:500],
                key_points=["Key points extracted"],
                sentiment=None,
                trends=None
            )


def get_llm_service() -> CerebrasLLMService:
    """Get or create LLM service instance"""
    api_key = os.getenv("Cerebras_API_KEY")
    if not api_key:
        raise ValueError("Cerebras_API_KEY environment variable is required")
    return CerebrasLLMService(api_key)
