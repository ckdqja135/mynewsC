# -*- coding: utf-8 -*-
"""
Performance comparison test for semantic search optimization.
Tests different configurations and measures response time.
"""

import sys
import io
import requests
import time
from datetime import datetime

# Set UTF-8 encoding for stdout
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

API_URL = "http://localhost:8000/api/news/semantic-search"


def test_performance(
    query: str,
    num: int,
    min_similarity: float,
    chunk_size: int = 100,
    early_stop_threshold: int = None,
    test_name: str = ""
):
    """
    Test semantic search performance with different configurations.

    Args:
        query: Search query
        num: Number of results requested
        min_similarity: Minimum similarity threshold
        chunk_size: Chunk size for processing
        early_stop_threshold: Early stop threshold (None = disabled)
        test_name: Name of this test case

    Returns:
        Dict with results and timing info
    """
    print(f"\n{'='*80}")
    print(f"Test: {test_name}")
    print(f"{'='*80}")
    print(f"Query: {query}")
    print(f"Requested results: {num}")
    print(f"Min similarity: {min_similarity}")
    print(f"Chunk size: {chunk_size}")
    print(f"Early stop threshold: {early_stop_threshold}")

    payload = {
        "q": query,
        "num": num,
        "min_similarity": min_similarity,
        "chunk_size": chunk_size
    }

    if early_stop_threshold:
        payload["early_stop_threshold"] = early_stop_threshold

    try:
        start_time = time.time()
        response = requests.post(API_URL, json=payload, timeout=120)
        end_time = time.time()

        response.raise_for_status()
        data = response.json()

        elapsed_time = end_time - start_time

        print(f"\n{'─'*80}")
        print(f"✓ Response time: {elapsed_time:.2f} seconds")
        print(f"✓ Total results: {data['total']}")

        if data['total'] > 0:
            scores = [article['similarity_score'] for article in data['articles']]
            print(f"✓ Similarity range: {min(scores):.3f} - {max(scores):.3f}")
            print(f"\nTop 5 Results:")
            for i, article in enumerate(data['articles'][:5], 1):
                print(f"  {i}. [{article['similarity_score']:.3f}] {article['title'][:70]}")

        return {
            "success": True,
            "elapsed_time": elapsed_time,
            "total_results": data['total'],
            "query": query,
            "config": {
                "num": num,
                "min_similarity": min_similarity,
                "chunk_size": chunk_size,
                "early_stop_threshold": early_stop_threshold
            }
        }

    except requests.exceptions.ConnectionError:
        print("\n[ERROR] Could not connect to the server.")
        print("Please make sure the backend server is running:")
        print("  cd backend && uvicorn app.main:app --reload")
        return {"success": False, "error": "Connection error"}

    except requests.exceptions.Timeout:
        print("\n[ERROR] Request timed out.")
        return {"success": False, "error": "Timeout"}

    except Exception as e:
        print(f"\n[ERROR] {str(e)}")
        return {"success": False, "error": str(e)}


def run_performance_comparison():
    """
    Run a comprehensive performance comparison with different configurations.
    """
    print("\n" + "="*80)
    print("SEMANTIC SEARCH PERFORMANCE COMPARISON")
    print("="*80)
    print(f"Start time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    query = "인공지능"
    results = []

    # Test 1: Baseline - No optimization (high threshold to limit results)
    results.append(test_performance(
        query=query,
        num=100,
        min_similarity=0.5,  # High threshold
        chunk_size=1000,  # Large chunk = process all at once
        early_stop_threshold=None,
        test_name="Test 1: Strict filtering (min_similarity=0.5)"
    ))

    # Test 2: Low threshold without early stop
    results.append(test_performance(
        query=query,
        num=100,
        min_similarity=0.2,  # Low threshold = many results
        chunk_size=100,
        early_stop_threshold=None,
        test_name="Test 2: Lenient filtering, no early stop (min_similarity=0.2)"
    ))

    # Test 3: Low threshold WITH early stop (OPTIMIZED)
    results.append(test_performance(
        query=query,
        num=100,
        min_similarity=0.2,
        chunk_size=100,
        early_stop_threshold=300,  # Stop after finding 300 results
        test_name="Test 3: Lenient filtering + Early stop (OPTIMIZED)"
    ))

    # Test 4: Very low threshold with aggressive early stop
    results.append(test_performance(
        query=query,
        num=100,
        min_similarity=0.1,
        chunk_size=100,
        early_stop_threshold=200,  # Aggressive early stop
        test_name="Test 4: Very lenient + Aggressive early stop"
    ))

    # Summary
    print("\n\n" + "="*80)
    print("PERFORMANCE SUMMARY")
    print("="*80)

    successful_tests = [r for r in results if r.get("success")]

    if successful_tests:
        print(f"\n{'Test':<50} {'Time (s)':<12} {'Results':<10}")
        print("-"*80)

        for i, result in enumerate(successful_tests, 1):
            config = result['config']
            test_desc = f"Test {i}: sim={config['min_similarity']}, early_stop={config.get('early_stop_threshold', 'None')}"
            time_str = f"{result['elapsed_time']:.2f}s"
            results_str = str(result['total_results'])

            print(f"{test_desc:<50} {time_str:<12} {results_str:<10}")

        # Calculate improvements
        if len(successful_tests) >= 3:
            baseline_time = successful_tests[1]['elapsed_time']  # Test 2 (no early stop)
            optimized_time = successful_tests[2]['elapsed_time']  # Test 3 (with early stop)

            if baseline_time > 0:
                improvement = ((baseline_time - optimized_time) / baseline_time) * 100
                print("\n" + "="*80)
                print(f"⚡ Performance improvement: {improvement:.1f}% faster with early stopping")
                print(f"   Baseline (Test 2): {baseline_time:.2f}s")
                print(f"   Optimized (Test 3): {optimized_time:.2f}s")
                print("="*80)

    else:
        print("\n[WARNING] No successful tests to compare.")

    print(f"\nEnd time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


def test_different_chunk_sizes():
    """Test how different chunk sizes affect performance."""
    print("\n\n" + "="*80)
    print("CHUNK SIZE COMPARISON")
    print("="*80)

    query = "경제"
    results = []

    for chunk_size in [50, 100, 200, 500]:
        results.append(test_performance(
            query=query,
            num=50,
            min_similarity=0.25,
            chunk_size=chunk_size,
            early_stop_threshold=150,
            test_name=f"Chunk size: {chunk_size}"
        ))

    # Summary
    print("\n" + "-"*80)
    print("Chunk Size Impact:")
    print("-"*80)
    successful = [r for r in results if r.get("success")]

    for result in successful:
        chunk_size = result['config']['chunk_size']
        time = result['elapsed_time']
        print(f"Chunk size {chunk_size:3d}: {time:.2f}s")


if __name__ == "__main__":
    print("\n🚀 Starting Performance Tests...")
    print("Note: Make sure the backend server is running on http://localhost:8000")
    print("\nThis will test:")
    print("  1. Strict filtering (high min_similarity)")
    print("  2. Lenient filtering without optimization")
    print("  3. Lenient filtering WITH early stop (optimized)")
    print("  4. Very lenient with aggressive early stop")
    print("\nPress Ctrl+C to cancel...")

    try:
        time.sleep(2)
        run_performance_comparison()
        test_different_chunk_sizes()

        print("\n\n✅ All tests completed!")

    except KeyboardInterrupt:
        print("\n\n❌ Tests cancelled by user.")
    except Exception as e:
        print(f"\n\n❌ Tests failed: {str(e)}")
