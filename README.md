# News Crawler

News aggregation system using SerpAPI Google News with FastAPI backend and Next.js frontend.

## Features

- **Multiple News Sources**: Google News (SerpAPI), Naver News API, RSS Feeds
- **Keyword Search**: Traditional keyword-based search with date sorting
- **Semantic Search**: AI-powered meaning-based search with Korean language support
- **Similarity Scoring**: Relevance scores for semantic search results
- SHA256-based article ID generation (url|title)
- Date parsing for Naver (RFC2822) and Google (relative time)
- Rate limiting (60 requests/minute per IP)
- TypeScript types and Pydantic models
- Clean error handling
- CORS enabled for local development

## Project Structure

```
newsCrawling/
├── backend/              # FastAPI backend
│   ├── app/
│   │   ├── main.py      # FastAPI app and endpoints
│   │   ├── models.py    # Pydantic models
│   │   ├── services/    # News crawler service
│   │   ├── middleware/  # Rate limiting middleware
│   │   └── utils/       # ID generation, date parsing
│   ├── requirements.txt
│   └── .env.example
├── frontend/            # Next.js frontend
│   ├── src/
│   │   ├── app/        # Next.js app directory
│   │   ├── types/      # TypeScript types
│   │   └── services/   # API service layer
│   ├── package.json
│   └── .env.example
└── README.md
```

## Setup

### Backend

1. Navigate to backend directory:
```bash
cd backend
```

2. Create virtual environment and install dependencies:
```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

3. Create `.env` file from example:
```bash
cp .env.example .env
```

4. Add your SerpAPI key to `.env`:
```env
SERPAPI_KEY=your_actual_serpapi_key
PORT=8000
RATE_LIMIT_PER_MINUTE=60
```

5. Run the server:
```bash
uvicorn app.main:app --reload --port 8000
```

API will be available at `http://localhost:8000`
- Docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/health`

### Frontend

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env.local` file:
```bash
cp .env.example .env.local
```

4. Run the development server:
```bash
npm run dev
```

Frontend will be available at `http://localhost:3000`

## API Endpoints

### POST /api/news/search

Keyword-based search for news articles (sorted by date).

**Request:**
```json
{
  "q": "검색어",
  "hl": "ko",
  "gl": "kr",
  "num": 100
}
```

**Response:**
```json
{
  "articles": [
    {
      "id": "f3a2b1c4d5e6f7g8h9i0j1k2",
      "title": "뉴스 제목",
      "url": "https://example.com/news",
      "source": "News Source",
      "publishedAt": "2026-01-29T10:30:00Z",
      "snippet": "뉴스 요약...",
      "thumbnail": "https://example.com/image.jpg"
    }
  ],
  "total": 10,
  "query": "검색어"
}
```

### POST /api/news/semantic-search

Semantic search using AI embeddings (sorted by relevance). 🆕

**Request:**
```json
{
  "q": "인공지능",
  "hl": "ko",
  "gl": "kr",
  "num": 100,
  "min_similarity": 0.3
}
```

**Response:**
```json
{
  "articles": [
    {
      "id": "f3a2b1c4d5e6f7g8h9i0j1k2",
      "title": "뉴스 제목",
      "url": "https://example.com/news",
      "source": "News Source",
      "publishedAt": "2026-01-29T10:30:00Z",
      "snippet": "뉴스 요약...",
      "thumbnail": "https://example.com/image.jpg",
      "similarity_score": 0.87
    }
  ],
  "total": 10,
  "query": "인공지능"
}
```

**Learn more**: See [SEMANTIC_SEARCH.md](./SEMANTIC_SEARCH.md) for detailed documentation.

### GET /health

Health check endpoint.

## Security

- **Never** commit `.env` files
- SerpAPI key is stored server-side only
- Rate limiting prevents abuse
- CORS configured for localhost development

## Rate Limiting

- Default: 60 requests per minute per IP
- Returns 429 status when exceeded
- Configurable via `RATE_LIMIT_PER_MINUTE` environment variable

## Date Parsing

- **Naver**: RFC2822 format (e.g., "Wed, 29 Jan 2026 10:30:00 GMT")
- **Google**: Relative time (e.g., "2 hours ago", "1 day ago")
- Parse failures allowed for Google (sorted to end)

## ID Generation

Article IDs generated using: `sha256(url|title)[:24]`

Example:
```python
url = "https://example.com/article"
title = "News Title"
id = sha256(f"{url}|{title}").hexdigest()[:24]
# Result: "f3a2b1c4d5e6f7g8h9i0j1k2"
```

## Error Handling

All errors return proper HTTP status codes:
- 400: Bad request (invalid parameters)
- 429: Rate limit exceeded
- 500: Server error

Error response format:
```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

## Semantic Search Feature

The semantic search feature uses Sentence Transformers with a Korean-optimized model to understand the meaning of your query and find relevant articles, even if they don't contain the exact keywords.

### Quick Start

1. Install dependencies (includes sentence-transformers):
```bash
cd backend
pip install -r requirements.txt
```

2. Start the server (model loads automatically):
```bash
uvicorn app.main:app --reload
```

3. Test the semantic search:
```bash
curl -X POST http://localhost:8000/api/news/semantic-search \
  -H "Content-Type: application/json" \
  -d '{"q": "AI 기술", "min_similarity": 0.3}'
```

### Key Features

- **Korean Language Support**: Optimized for Korean news articles
- **Semantic Understanding**: Finds related articles even with different wording
- **Synonym Matching**: "AI" and "인공지능" both work
- **Relevance Scoring**: Each result includes a similarity score (0-1)
- **Configurable Threshold**: Filter results by minimum similarity

### Documentation

- **[Quick Start Guide](./QUICKSTART_SEMANTIC_SEARCH.md)**: Get started in 5 minutes
- **[Technical Documentation](./SEMANTIC_SEARCH.md)**: Complete API reference
- **[Frontend Integration](./FRONTEND_INTEGRATION_EXAMPLE.md)**: React/Next.js examples
- **[Implementation Summary](./IMPLEMENTATION_SUMMARY.md)**: Technical details

### Comparison: Keyword vs Semantic Search

| Feature | Keyword Search | Semantic Search |
|---------|---------------|-----------------|
| Matching | Exact words | Meaning-based |
| Sorting | By date | By relevance |
| Speed | Fast (~1s) | Moderate (~3-5s) |
| Synonyms | ❌ No | ✅ Yes |
| Related topics | ❌ No | ✅ Yes |
| Best for | Latest news | Concept exploration |

### Testing

Run the test suite:
```bash
cd backend
python test_semantic_search.py
python test_api_semantic_search.py
```
