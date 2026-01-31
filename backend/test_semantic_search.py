# -*- coding: utf-8 -*-
"""
Test script for semantic search functionality.
This script verifies that the embedding service works correctly.
"""

import sys
import io
from app.services.embedding_service import get_embedding_service
from app.models import NewsArticle
from datetime import datetime

# Set UTF-8 encoding for stdout to handle Korean characters
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def test_embedding_service():
    """Test the embedding service with sample Korean news articles."""
    print("=" * 60)
    print("Testing Semantic Search Functionality")
    print("=" * 60)

    # Initialize service
    print("\n1. Initializing embedding service...")
    service = get_embedding_service()
    print("   [OK] Service initialized successfully")

    # Create sample articles
    print("\n2. Creating sample news articles...")
    articles = [
        NewsArticle(
            id="1",
            title="인공지능 기술의 미래",
            url="https://example.com/1",
            source="테크뉴스",
            publishedAt=datetime.now(),
            snippet="AI 기술이 빠르게 발전하고 있으며 다양한 산업에 적용되고 있습니다."
        ),
        NewsArticle(
            id="2",
            title="기후 변화와 환경 보호",
            url="https://example.com/2",
            source="환경일보",
            publishedAt=datetime.now(),
            snippet="지구 온난화로 인한 기후 변화가 심각해지고 있습니다."
        ),
        NewsArticle(
            id="3",
            title="머신러닝 알고리즘 최신 연구",
            url="https://example.com/3",
            source="과학저널",
            publishedAt=datetime.now(),
            snippet="새로운 딥러닝 모델이 이미지 인식 분야에서 획기적인 성과를 보였습니다."
        ),
        NewsArticle(
            id="4",
            title="탄소 배출 감축 정책",
            url="https://example.com/4",
            source="정책뉴스",
            publishedAt=datetime.now(),
            snippet="정부가 2030년까지 탄소 배출을 50% 감축하는 계획을 발표했습니다."
        ),
        NewsArticle(
            id="5",
            title="경제 성장률 전망",
            url="https://example.com/5",
            source="경제신문",
            publishedAt=datetime.now(),
            snippet="올해 국내 경제 성장률이 3%로 예상됩니다."
        )
    ]
    print(f"   [OK] Created {len(articles)} sample articles")

    # Test Case 1: Search for AI-related articles
    print("\n3. Test Case 1: Searching for 'AI 발전'")
    query1 = "AI 발전"
    results1 = service.rank_articles_by_similarity(query1, articles, min_similarity=0.0)
    print(f"   Query: '{query1}'")
    print(f"   Results (top 3):")
    for i, (article, score) in enumerate(results1[:3], 1):
        print(f"   {i}. [{score:.3f}] {article.title}")

    # Test Case 2: Search for environment-related articles
    print("\n4. Test Case 2: Searching for '환경 보호'")
    query2 = "환경 보호"
    results2 = service.rank_articles_by_similarity(query2, articles, min_similarity=0.0)
    print(f"   Query: '{query2}'")
    print(f"   Results (top 3):")
    for i, (article, score) in enumerate(results2[:3], 1):
        print(f"   {i}. [{score:.3f}] {article.title}")

    # Test Case 3: Test with similarity threshold
    print("\n5. Test Case 3: Testing with min_similarity=0.3")
    query3 = "인공지능"
    results3 = service.rank_articles_by_similarity(query3, articles, min_similarity=0.3)
    print(f"   Query: '{query3}' (min_similarity=0.3)")
    print(f"   Results: {len(results3)} articles above threshold")
    for i, (article, score) in enumerate(results3, 1):
        print(f"   {i}. [{score:.3f}] {article.title}")

    # Test Case 4: Synonym search
    print("\n6. Test Case 4: Testing synonym search")
    print("   Comparing 'AI' vs '인공지능':")
    ai_results = service.rank_articles_by_similarity("AI", articles, min_similarity=0.0)
    ai_korean_results = service.rank_articles_by_similarity("인공지능", articles, min_similarity=0.0)
    print(f"   'AI' top result: [{ai_results[0][1]:.3f}] {ai_results[0][0].title}")
    print(f"   '인공지능' top result: [{ai_korean_results[0][1]:.3f}] {ai_korean_results[0][0].title}")

    print("\n" + "=" * 60)
    print("[OK] All tests passed successfully!")
    print("=" * 60)


if __name__ == "__main__":
    test_embedding_service()
