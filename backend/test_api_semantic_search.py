# -*- coding: utf-8 -*-
"""
API test script for semantic search endpoint.
Run the backend server first, then execute this script.
"""

import sys
import io
import requests
import json
from datetime import datetime

# Set UTF-8 encoding for stdout
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

API_URL = "http://localhost:8000/api/news/semantic-search"


def test_semantic_search_api():
    """Test the semantic search API endpoint."""
    print("=" * 70)
    print("Semantic Search API Test")
    print("=" * 70)
    print(f"\nAPI Endpoint: {API_URL}")
    print("Note: Make sure the backend server is running!")
    print()

    # Test Case 1: Basic search
    print("\n" + "-" * 70)
    print("Test Case 1: Basic semantic search for 'AI 기술'")
    print("-" * 70)

    payload1 = {
        "q": "AI 기술",
        "num": 10,
        "min_similarity": 0.3
    }

    try:
        response1 = requests.post(API_URL, json=payload1, timeout=30)
        response1.raise_for_status()
        data1 = response1.json()

        print(f"\nQuery: {data1['query']}")
        print(f"Total Results: {data1['total']}")
        print("\nTop 5 Results:")

        for i, article in enumerate(data1['articles'][:5], 1):
            print(f"\n{i}. [{article['similarity_score']:.3f}] {article['title']}")
            print(f"   Source: {article['source']}")
            print(f"   URL: {article['url'][:60]}...")
            if article.get('snippet'):
                snippet = article['snippet'][:100]
                print(f"   Preview: {snippet}...")

    except requests.exceptions.ConnectionError:
        print("[ERROR] Could not connect to the server.")
        print("Please make sure the backend server is running:")
        print("  cd backend && uvicorn app.main:app --reload")
        return
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        return

    # Test Case 2: Different query
    print("\n" + "-" * 70)
    print("Test Case 2: Search for '환경 보호'")
    print("-" * 70)

    payload2 = {
        "q": "환경 보호",
        "num": 10,
        "min_similarity": 0.35
    }

    try:
        response2 = requests.post(API_URL, json=payload2, timeout=30)
        response2.raise_for_status()
        data2 = response2.json()

        print(f"\nQuery: {data2['query']}")
        print(f"Total Results: {data2['total']}")
        print(f"Min Similarity: {payload2['min_similarity']}")
        print("\nTop 3 Results:")

        for i, article in enumerate(data2['articles'][:3], 1):
            print(f"\n{i}. [{article['similarity_score']:.3f}] {article['title']}")
            print(f"   Source: {article['source']}")

    except Exception as e:
        print(f"[ERROR] {str(e)}")

    # Test Case 3: High threshold
    print("\n" + "-" * 70)
    print("Test Case 3: High similarity threshold (0.6)")
    print("-" * 70)

    payload3 = {
        "q": "경제 성장",
        "num": 20,
        "min_similarity": 0.6
    }

    try:
        response3 = requests.post(API_URL, json=payload3, timeout=30)
        response3.raise_for_status()
        data3 = response3.json()

        print(f"\nQuery: {data3['query']}")
        print(f"Total Results: {data3['total']}")
        print(f"Min Similarity: {payload3['min_similarity']}")

        if data3['total'] > 0:
            print("\nResults:")
            for i, article in enumerate(data3['articles'], 1):
                print(f"{i}. [{article['similarity_score']:.3f}] {article['title']}")
        else:
            print("\nNo articles found above the similarity threshold.")

    except Exception as e:
        print(f"[ERROR] {str(e)}")

    print("\n" + "=" * 70)
    print("[OK] API tests completed!")
    print("=" * 70)


def compare_search_modes():
    """Compare keyword search vs semantic search."""
    print("\n\n" + "=" * 70)
    print("Comparison: Keyword Search vs Semantic Search")
    print("=" * 70)

    query = "AI"

    # Keyword search
    print("\n1. Keyword Search: /api/news/search")
    try:
        keyword_response = requests.post(
            "http://localhost:8000/api/news/search",
            json={"q": query, "num": 5},
            timeout=30
        )
        keyword_response.raise_for_status()
        keyword_data = keyword_response.json()

        print(f"   Results: {keyword_data['total']}")
        print("   Top 3 titles:")
        for i, article in enumerate(keyword_data['articles'][:3], 1):
            print(f"   {i}. {article['title'][:60]}...")

    except Exception as e:
        print(f"   [ERROR] {str(e)}")

    # Semantic search
    print("\n2. Semantic Search: /api/news/semantic-search")
    try:
        semantic_response = requests.post(
            API_URL,
            json={"q": query, "num": 5, "min_similarity": 0.3},
            timeout=30
        )
        semantic_response.raise_for_status()
        semantic_data = semantic_response.json()

        print(f"   Results: {semantic_data['total']}")
        print("   Top 3 titles with scores:")
        for i, article in enumerate(semantic_data['articles'][:3], 1):
            score = article['similarity_score']
            print(f"   {i}. [{score:.2f}] {article['title'][:50]}...")

    except Exception as e:
        print(f"   [ERROR] {str(e)}")

    print("\n" + "=" * 70)


if __name__ == "__main__":
    test_semantic_search_api()
    compare_search_modes()
