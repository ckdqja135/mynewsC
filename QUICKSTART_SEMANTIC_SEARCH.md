# Semantic Search Quick Start Guide

## Installation

1. Install the new dependencies:
```bash
cd backend
pip install -r requirements.txt
```

This will install:
- `sentence-transformers==3.3.1` (Korean language model)
- `scikit-learn==1.6.1` (similarity calculations)

## Starting the Server

```bash
cd backend
uvicorn app.main:app --reload
```

The server will:
1. Load the Korean embedding model (takes 10-15 seconds)
2. Start on `http://localhost:8000`
3. Show "Embedding model loaded successfully" in logs

## Testing the Feature

### Option 1: Run the Test Script

```bash
cd backend
python test_semantic_search.py
```

This runs unit tests with sample Korean news articles.

### Option 2: Test the API Endpoint

First, start the server, then in a new terminal:

```bash
cd backend
python test_api_semantic_search.py
```

This sends real API requests to the semantic search endpoint.

### Option 3: Use curl

```bash
curl -X POST http://localhost:8000/api/news/semantic-search \
  -H "Content-Type: application/json" \
  -d '{"q": "인공지능", "num": 10, "min_similarity": 0.3}'
```

### Option 4: Use the API Documentation

1. Open `http://localhost:8000/docs` in your browser
2. Find the `/api/news/semantic-search` endpoint
3. Click "Try it out"
4. Enter your search parameters
5. Click "Execute"

## Example Queries

### Search for AI/Technology News
```json
{
  "q": "인공지능 발전",
  "num": 20,
  "min_similarity": 0.4
}
```

### Search for Environmental News
```json
{
  "q": "환경 보호",
  "num": 15,
  "min_similarity": 0.35
}
```

### Broad Search with Low Threshold
```json
{
  "q": "경제",
  "num": 50,
  "min_similarity": 0.2
}
```

### Strict Search with High Threshold
```json
{
  "q": "기후 변화",
  "num": 10,
  "min_similarity": 0.6
}
```

## Understanding Similarity Scores

The `similarity_score` in the response ranges from 0 to 1:

- **0.8 - 1.0**: Highly relevant, very similar meaning
- **0.6 - 0.8**: Relevant, related topic
- **0.4 - 0.6**: Moderately relevant, some connection
- **0.2 - 0.4**: Loosely related, tangential connection
- **0.0 - 0.2**: Barely related or unrelated

### Recommended Thresholds

- **Strict search**: `min_similarity: 0.5-0.7`
- **Balanced search**: `min_similarity: 0.3-0.5` (default: 0.3)
- **Broad search**: `min_similarity: 0.1-0.3`

## Sample Response

```json
{
  "articles": [
    {
      "id": "news_123",
      "title": "인공지능 기술의 미래 전망",
      "url": "https://example.com/news/ai-future",
      "source": "TechNews",
      "publishedAt": "2026-01-30T10:00:00Z",
      "snippet": "AI 기술이 빠르게 발전하면서...",
      "thumbnail": "https://example.com/img.jpg",
      "similarity_score": 0.87
    }
  ],
  "total": 15,
  "query": "AI 발전"
}
```

## Comparing with Keyword Search

| Feature | Keyword Search | Semantic Search |
|---------|---------------|-----------------|
| Endpoint | `/api/news/search` | `/api/news/semantic-search` |
| Matching | Exact keywords | Semantic similarity |
| Sorting | By date | By relevance score |
| Speed | Fast (~1s) | Moderate (~3-5s) |
| Use Case | Recent news | Concept exploration |

### When to Use Keyword Search
- You want the latest news
- You know exact terms/names
- You need fast results

### When to Use Semantic Search
- You're exploring a concept
- You want related topics
- Exact keywords aren't important
- You want the most relevant content

## Troubleshooting

### Server won't start
```
Failed to initialize embedding service
```

**Solution**: Ensure you have enough RAM (2GB+) and reinstall dependencies:
```bash
pip install --force-reinstall sentence-transformers scikit-learn
```

### No results returned
```json
{
  "articles": [],
  "total": 0
}
```

**Possible causes**:
1. `min_similarity` threshold too high → Lower it (try 0.2)
2. No articles match the query → Try different keywords
3. News sources returned no data → Check API keys

### Slow responses

**Solutions**:
1. Reduce `num` parameter (fewer articles to process)
2. Enable GPU if available (PyTorch will use it automatically)
3. Increase `min_similarity` (returns fewer results faster)

## Next Steps

1. **Integrate with Frontend**: Add a toggle for semantic search in your UI
2. **Tune Thresholds**: Experiment with `min_similarity` values for your use case
3. **Monitor Performance**: Track response times and adjust `num` parameter
4. **Hybrid Search**: Combine keyword and semantic search results

## Additional Resources

- Full documentation: `SEMANTIC_SEARCH.md`
- API docs: `http://localhost:8000/docs`
- Test scripts: `test_semantic_search.py`, `test_api_semantic_search.py`
