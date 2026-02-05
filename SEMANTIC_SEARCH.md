# Semantic Search Feature Documentation

## Overview

The semantic search feature uses Sentence Transformers with a Korean-optimized model to provide meaning-based news article search. Instead of simple keyword matching, it understands the semantic similarity between your query and news articles.

## Key Features

- **Korean Language Support**: Uses `jhgan/ko-sroberta-multitask` model optimized for Korean
- **Semantic Understanding**: Finds related articles even with different wording
- **Synonym Matching**: "AI" and "인공지능" both find artificial intelligence articles
- **Similarity Scoring**: Each result includes a similarity score (0-1)
- **Configurable Threshold**: Filter results by minimum similarity score

## API Endpoint

### POST `/api/news/semantic-search`

Performs semantic search across all news sources.

#### Request Body

```json
{
  "q": "인공지능 발전",
  "hl": "ko",
  "gl": "kr",
  "num": 100,
  "min_similarity": 0.3
}
```

**Parameters:**
- `q` (required): Search query (1-200 characters)
- `hl` (optional): Language code, default: "ko"
- `gl` (optional): Country code, default: "kr"
- `num` (optional): Number of results, default: 100, max: 500
- `min_similarity` (optional): Minimum similarity threshold (0.0-1.0), default: 0.3

#### Response

```json
{
  "articles": [
    {
      "id": "abc123",
      "title": "인공지능 기술의 미래",
      "url": "https://example.com/news/1",
      "source": "테크뉴스",
      "publishedAt": "2026-01-30T10:00:00Z",
      "snippet": "AI 기술이 빠르게 발전하고 있습니다...",
      "thumbnail": "https://example.com/img.jpg",
      "similarity_score": 0.87
    }
  ],
  "total": 25,
  "query": "인공지능 발전"
}
```

## How It Works

1. **Data Collection**: Fetches news from all sources (Google News, Naver, RSS feeds)
2. **Deduplication**: Removes duplicate articles by ID
3. **Text Preparation**: Combines article title and snippet for richer context
4. **Embedding Generation**: Converts query and articles to vector embeddings
5. **Similarity Calculation**: Computes cosine similarity between query and articles
6. **Filtering**: Keeps only articles above the similarity threshold
7. **Ranking**: Sorts results by similarity score (highest first)

## Usage Examples

### Example 1: Basic Semantic Search

```bash
curl -X POST http://localhost:8000/api/news/semantic-search \
  -H "Content-Type: application/json" \
  -d '{
    "q": "AI 발전",
    "num": 10
  }'
```

### Example 2: With Custom Threshold

```bash
curl -X POST http://localhost:8000/api/news/semantic-search \
  -H "Content-Type: application/json" \
  -d '{
    "q": "환경 보호",
    "min_similarity": 0.5,
    "num": 20
  }'
```

### Example 3: Using Python Requests

```python
import requests

response = requests.post(
    "http://localhost:8000/api/news/semantic-search",
    json={
        "q": "기후 변화",
        "min_similarity": 0.4,
        "num": 50
    }
)

data = response.json()
for article in data["articles"]:
    print(f"[{article['similarity_score']:.2f}] {article['title']}")
```

## Semantic Search vs Keyword Search

### Keyword Search (`/api/news/search`)
- Exact word matching
- Returns all articles containing keywords
- Sorted by date (newest first)
- Fast but may miss related content

### Semantic Search (`/api/news/semantic-search`)
- Meaning-based matching
- Finds semantically similar articles
- Sorted by relevance (similarity score)
- Better for conceptual queries

## Performance Considerations

### Model Loading
- Model loads once when the server starts
- Subsequent requests reuse the loaded model
- Initial startup takes ~10-15 seconds

### Response Time
- Typical response: 3-5 seconds for 100 articles
- GPU acceleration supported (if available)
- Batch processing optimizes embedding generation

### Memory Usage
- Model size: ~500MB RAM
- Scales with number of articles processed
- Recommended: 2GB+ RAM available

## Testing

Run the included test script:

```bash
cd backend
python test_semantic_search.py
```

This validates:
- Embedding service initialization
- Similarity scoring accuracy
- Korean language support
- Synonym matching capability
- Threshold filtering

## Troubleshooting

### Service Unavailable Error

```json
{
  "detail": "Semantic search is not available. Embedding service failed to initialize."
}
```

**Cause**: The embedding model failed to load during startup.

**Solutions**:
1. Check if `sentence-transformers` is installed
2. Verify sufficient memory (2GB+)
3. Check server logs for initialization errors
4. Try reinstalling: `pip install sentence-transformers==3.3.1`

### Slow Response Times

**Cause**: Large number of articles or CPU processing.

**Solutions**:
1. Reduce `num` parameter (fewer articles to process)
2. Use GPU if available (automatic with PyTorch)
3. Increase `min_similarity` threshold (fewer results)

### Low Quality Results

**Cause**: Threshold too low or query too generic.

**Solutions**:
1. Increase `min_similarity` (e.g., 0.4 or 0.5)
2. Use more specific queries
3. Check if articles actually match your intent

## Implementation Files

- `backend/app/services/embedding_service.py` - Core embedding logic
- `backend/app/models.py` - Request/response models
- `backend/app/main.py` - API endpoint
- `backend/requirements.txt` - Dependencies
- `backend/test_semantic_search.py` - Test suite

## Dependencies

```
sentence-transformers==3.3.1
scikit-learn==1.6.1
```

Plus their dependencies (PyTorch, Transformers, etc.)

## Future Enhancements

Potential improvements:
- Vector database (Pinecone, Weaviate) for faster searches
- Caching of article embeddings
- Multi-language model support
- Fine-tuned model for news domain
- Hybrid search (keyword + semantic)
