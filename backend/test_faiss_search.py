"""
Test script for FAISS-based semantic search performance.
Compares FAISS method vs original chunked method.
"""

import asyncio
import time
from app.models import NewsArticle, SemanticSearchRequest
from app.services.embedding_service import get_embedding_service
from datetime import datetime, timezone


def create_sample_articles(count: int = 1000) -> list:
    """Create sample articles for testing"""
    topics = [
        ("인공지능", "AI 기술이 발전하고 있습니다"),
        ("환경", "기후 변화에 대한 대응이 필요합니다"),
        ("경제", "주식 시장이 상승세를 보이고 있습니다"),
        ("스포츠", "올림픽에서 한국 선수가 금메달을 땄습니다"),
        ("정치", "국회에서 새로운 법안이 통과되었습니다"),
        ("문화", "K-POP이 세계적으로 인기를 끌고 있습니다"),
        ("과학", "새로운 우주 탐사 미션이 시작됩니다"),
        ("의료", "백신 개발이 빠르게 진행되고 있습니다"),
        ("교육", "온라인 교육이 확대되고 있습니다"),
        ("기술", "5G 네트워크가 상용화되었습니다"),
    ]

    articles = []
    for i in range(count):
        topic_idx = i % len(topics)
        title, snippet = topics[topic_idx]

        article = NewsArticle(
            id=f"article_{i}",
            title=f"{title} 관련 뉴스 {i}",
            url=f"https://example.com/news/{i}",
            source="테스트뉴스",
            publishedAt=datetime.now(timezone.utc),
            snippet=f"{snippet} (기사 번호: {i})"
        )
        articles.append(article)

    return articles


async def test_faiss_performance():
    """Test FAISS search performance"""
    print("=" * 80)
    print("FAISS Semantic Search Performance Test")
    print("=" * 80)

    # Initialize embedding service
    print("\n1. Initializing embedding service...")
    embedding_service = get_embedding_service()

    # Create sample articles
    print("\n2. Creating sample articles...")
    num_articles = 1000
    articles = create_sample_articles(num_articles)
    print(f"   Created {len(articles)} sample articles")

    # Test query
    query = "인공지능 기술"
    min_similarity = 0.2
    num_results = 100

    print(f"\n3. Test Configuration:")
    print(f"   Query: {query}")
    print(f"   Articles: {num_articles}")
    print(f"   Min Similarity: {min_similarity}")
    print(f"   Requested Results: {num_results}")

    # Test 1: FAISS Method (First Run - builds index)
    print("\n" + "=" * 80)
    print("Test 1: FAISS Method (First Run - Building Index)")
    print("=" * 80)

    start_time = time.time()
    results_faiss_1 = embedding_service.rank_articles_by_similarity_faiss(
        query=query,
        articles=articles,
        min_similarity=min_similarity,
        max_results=num_results
    )
    elapsed_faiss_1 = time.time() - start_time

    print(f"\nResults:")
    print(f"   Time: {elapsed_faiss_1:.2f} seconds")
    print(f"   Found: {len(results_faiss_1)} articles")
    if results_faiss_1:
        print(f"   Top similarity: {results_faiss_1[0][1]:.4f}")
        print(f"\n   Top 3 Results:")
        for i, (article, score) in enumerate(results_faiss_1[:3], 1):
            print(f"      {i}. [{score:.4f}] {article.title}")

    # Test 2: FAISS Method (Second Run - uses cache)
    print("\n" + "=" * 80)
    print("Test 2: FAISS Method (Second Run - Using Cache)")
    print("=" * 80)

    start_time = time.time()
    results_faiss_2 = embedding_service.rank_articles_by_similarity_faiss(
        query=query,
        articles=articles,
        min_similarity=min_similarity,
        max_results=num_results
    )
    elapsed_faiss_2 = time.time() - start_time

    print(f"\nResults:")
    print(f"   Time: {elapsed_faiss_2:.2f} seconds")
    print(f"   Found: {len(results_faiss_2)} articles")
    print(f"   Speedup vs First Run: {elapsed_faiss_1 / elapsed_faiss_2:.2f}x faster")

    # Test 3: Original Chunked Method (for comparison)
    print("\n" + "=" * 80)
    print("Test 3: Original Chunked Method (for comparison)")
    print("=" * 80)

    start_time = time.time()
    results_original = embedding_service.rank_articles_by_similarity(
        query=query,
        articles=articles,
        min_similarity=min_similarity,
        chunk_size=100,
        max_results=num_results,
        early_stop_threshold=300
    )
    elapsed_original = time.time() - start_time

    print(f"\nResults:")
    print(f"   Time: {elapsed_original:.2f} seconds")
    print(f"   Found: {len(results_original)} articles")
    if results_original:
        print(f"   Top similarity: {results_original[0][1]:.4f}")

    # Performance Summary
    print("\n" + "=" * 80)
    print("Performance Summary")
    print("=" * 80)

    print(f"\nMethod Comparison:")
    print(f"   Original Chunked:  {elapsed_original:.2f}s")
    print(f"   FAISS (1st run):   {elapsed_faiss_1:.2f}s")
    print(f"   FAISS (cached):    {elapsed_faiss_2:.2f}s")

    print(f"\nSpeedup:")
    print(f"   FAISS 1st run vs Original: {elapsed_original / elapsed_faiss_1:.2f}x")
    print(f"   FAISS cached vs Original:  {elapsed_original / elapsed_faiss_2:.2f}x")

    # Test 4: Different query (cache test)
    print("\n" + "=" * 80)
    print("Test 4: Different Query (Testing Cache)")
    print("=" * 80)

    query2 = "환경 보호"
    start_time = time.time()
    results_query2 = embedding_service.rank_articles_by_similarity_faiss(
        query=query2,
        articles=articles,
        min_similarity=min_similarity,
        max_results=num_results
    )
    elapsed_query2 = time.time() - start_time

    print(f"\nQuery: {query2}")
    print(f"   Time: {elapsed_query2:.2f} seconds")
    print(f"   Found: {len(results_query2)} articles")
    if results_query2:
        print(f"\n   Top 3 Results:")
        for i, (article, score) in enumerate(results_query2[:3], 1):
            print(f"      {i}. [{score:.4f}] {article.title}")

    # Index Statistics
    print("\n" + "=" * 80)
    print("FAISS Index Statistics")
    print("=" * 80)
    print(f"   Total vectors in index: {embedding_service.index.ntotal}")
    print(f"   Embedding dimension: {embedding_service.embedding_dim}")
    print(f"   Cached articles: {len(embedding_service.article_id_to_idx)}")
    print(f"   Index file: {embedding_service.index_path}")
    print(f"   Metadata file: {embedding_service.metadata_path}")

    print("\n" + "=" * 80)
    print("Test Complete!")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(test_faiss_performance())
