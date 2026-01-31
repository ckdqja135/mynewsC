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
