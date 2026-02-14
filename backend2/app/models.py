from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime


class NewsArticle(BaseModel):
    id: str
    title: str
    url: str
    source: str
    publishedAt: Optional[datetime] = None
    snippet: Optional[str] = None
    thumbnail: Optional[str] = None


class NewsSearchRequest(BaseModel):
    q: str = Field(..., min_length=1, max_length=200, description="Search query")
    hl: str = Field(default="ko", pattern="^[a-z]{2}$", description="Language code")
    gl: str = Field(default="kr", pattern="^[a-z]{2}$", description="Country code")
    num: int = Field(default=100, ge=1, le=500, description="Number of results (max 500)")
    excluded_sources: list[str] = Field(default=[], description="List of sources to exclude")

    @field_validator("q")
    @classmethod
    def validate_query(cls, v: str) -> str:
        if not v or v.strip() == "":
            raise ValueError("Query cannot be empty")
        return v.strip()


class NewsSearchResponse(BaseModel):
    articles: list[NewsArticle]
    total: int
    query: str


class SemanticSearchRequest(BaseModel):
    q: str = Field(..., min_length=1, max_length=200, description="Search query")
    hl: str = Field(default="ko", pattern="^[a-z]{2}$", description="Language code")
    gl: str = Field(default="kr", pattern="^[a-z]{2}$", description="Country code")
    num: int = Field(default=100, ge=1, le=500, description="Number of results (max 500)")
    excluded_sources: list[str] = Field(default=[], description="List of sources to exclude")
    min_similarity: float = Field(
        default=0.0,  # 기본값 0 (모든 결과 표시, 관련도순 정렬)
        ge=0.0,
        le=1.0,
        description="Minimum similarity threshold (0 to 1)"
    )
    chunk_size: int = Field(
        default=100,
        ge=10,
        le=500,
        description="Number of articles to process per chunk (for performance optimization)"
    )
    early_stop_threshold: Optional[int] = Field(
        default=None,
        ge=1,
        description="Stop processing after finding this many results (None = process all)"
    )

    @field_validator("q")
    @classmethod
    def validate_query(cls, v: str) -> str:
        if not v or v.strip() == "":
            raise ValueError("Query cannot be empty")
        return v.strip()


class NewsArticleWithScore(NewsArticle):
    similarity_score: float = Field(description="Semantic similarity score (0 to 1)")


class SemanticSearchResponse(BaseModel):
    articles: list[NewsArticleWithScore]
    total: int
    query: str


# LLM Analysis Models
class NewsAnalysisRequest(BaseModel):
    q: str = Field(..., min_length=1, max_length=200, description="Search query")
    hl: str = Field(default="ko", pattern="^[a-z]{2}$", description="Language code")
    gl: str = Field(default="kr", pattern="^[a-z]{2}$", description="Country code")
    num: int = Field(default=20, ge=1, le=100, description="Number of articles to analyze")
    analysis_type: str = Field(
        default="comprehensive",
        pattern="^(comprehensive|trend|sentiment|key_points)$",
        description="Type of analysis: comprehensive, trend, sentiment, or key_points"
    )
    days_back: int = Field(
        default=30,
        ge=1,
        le=365,
        description="Number of days to look back for articles (default: 30 days)"
    )
    excluded_sources: list[str] = Field(default=[], description="List of sources to exclude")

    @field_validator("q")
    @classmethod
    def validate_query(cls, v: str) -> str:
        if not v or v.strip() == "":
            raise ValueError("Query cannot be empty")
        return v.strip()


class SentimentAnalysis(BaseModel):
    overall_sentiment: str = Field(description="Overall sentiment: positive, negative, or neutral")
    sentiment_score: float = Field(description="Sentiment score from -1 (negative) to 1 (positive)")
    positive_aspects: list[str] = Field(description="Positive aspects mentioned in articles")
    negative_aspects: list[str] = Field(description="Negative aspects mentioned in articles")


class TrendAnalysis(BaseModel):
    main_topics: list[str] = Field(description="Main topics and themes")
    emerging_trends: list[str] = Field(description="Emerging trends and patterns")
    key_entities: list[str] = Field(description="Key people, organizations, or entities mentioned")


class NewsAnalysisResponse(BaseModel):
    query: str
    analysis_type: str
    articles_analyzed: int
    summary: str = Field(description="Overall summary of the analysis")
    key_points: list[str] = Field(description="Key takeaways and insights")
    sentiment: Optional[SentimentAnalysis] = None
    trends: Optional[TrendAnalysis] = None
    generated_at: datetime = Field(default_factory=datetime.now)
