"""
Test script for Cerebras LLM News Analysis
"""
import asyncio
import httpx


async def test_news_analysis():
    """Test news analysis endpoint"""
    base_url = "http://localhost:8000"

    # Test different analysis types
    test_cases = [
        {
            "name": "Comprehensive Analysis",
            "data": {
                "q": "인공지능",
                "num": 10,
                "analysis_type": "comprehensive"
            }
        },
        {
            "name": "Sentiment Analysis",
            "data": {
                "q": "경제",
                "num": 15,
                "analysis_type": "sentiment"
            }
        },
        {
            "name": "Trend Analysis",
            "data": {
                "q": "기술",
                "num": 10,
                "analysis_type": "trend"
            }
        },
        {
            "name": "Key Points",
            "data": {
                "q": "정치",
                "num": 10,
                "analysis_type": "key_points"
            }
        }
    ]

    async with httpx.AsyncClient(timeout=120.0) as client:
        for test_case in test_cases:
            print(f"\n{'='*60}")
            print(f"Testing: {test_case['name']}")
            print(f"{'='*60}")

            try:
                response = await client.post(
                    f"{base_url}/api/news/analyze",
                    json=test_case["data"]
                )

                if response.status_code == 200:
                    result = response.json()
                    print(f"✓ Success!")
                    print(f"\nQuery: {result['query']}")
                    print(f"Analysis Type: {result['analysis_type']}")
                    print(f"Articles Analyzed: {result['articles_analyzed']}")
                    print(f"\nSummary:\n{result['summary']}")

                    print(f"\nKey Points:")
                    for i, point in enumerate(result['key_points'], 1):
                        print(f"  {i}. {point}")

                    if result.get('sentiment'):
                        sentiment = result['sentiment']
                        print(f"\nSentiment Analysis:")
                        print(f"  Overall: {sentiment['overall_sentiment']}")
                        print(f"  Score: {sentiment['sentiment_score']}")
                        print(f"  Positive aspects: {', '.join(sentiment['positive_aspects'][:3])}")
                        print(f"  Negative aspects: {', '.join(sentiment['negative_aspects'][:3])}")

                    if result.get('trends'):
                        trends = result['trends']
                        print(f"\nTrend Analysis:")
                        print(f"  Main topics: {', '.join(trends['main_topics'][:3])}")
                        print(f"  Emerging trends: {', '.join(trends['emerging_trends'][:3])}")
                        print(f"  Key entities: {', '.join(trends['key_entities'][:3])}")

                else:
                    print(f"✗ Failed with status {response.status_code}")
                    print(f"Error: {response.text}")

            except Exception as e:
                print(f"✗ Error: {str(e)}")

            # Wait a bit between requests
            await asyncio.sleep(2)


if __name__ == "__main__":
    print("Starting Cerebras LLM News Analysis Test")
    print("Make sure the backend server is running on http://localhost:8000")
    print("\nPress Ctrl+C to stop\n")

    asyncio.run(test_news_analysis())
