# Frontend Integration Example

## Overview

This guide shows how to integrate the semantic search feature into your frontend application.

## React/Next.js Example

### 1. Create a Search Component with Mode Toggle

```typescript
// components/NewsSearch.tsx
'use client';

import { useState } from 'react';

type SearchMode = 'keyword' | 'semantic';

interface Article {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  snippet?: string;
  thumbnail?: string;
  similarity_score?: number; // Only present in semantic search
}

interface SearchResponse {
  articles: Article[];
  total: number;
  query: string;
}

export default function NewsSearch() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('semantic');
  const [minSimilarity, setMinSimilarity] = useState(0.3);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const endpoint = mode === 'semantic'
        ? '/api/news/semantic-search'
        : '/api/news/search';

      const body = mode === 'semantic'
        ? { q: query, num: 50, min_similarity: minSimilarity }
        : { q: query, num: 50 };

      const response = await fetch(`http://localhost:8000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data: SearchResponse = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Search Mode Toggle */}
      <div className="mb-4 flex gap-4 items-center">
        <label className="font-semibold">Search Mode:</label>
        <div className="flex gap-2">
          <button
            onClick={() => setMode('keyword')}
            className={`px-4 py-2 rounded ${
              mode === 'keyword'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            Keyword
          </button>
          <button
            onClick={() => setMode('semantic')}
            className={`px-4 py-2 rounded ${
              mode === 'semantic'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            Semantic
          </button>
        </div>
      </div>

      {/* Similarity Threshold (only for semantic search) */}
      {mode === 'semantic' && (
        <div className="mb-4">
          <label className="block font-semibold mb-2">
            Minimum Similarity: {minSimilarity.toFixed(1)}
          </label>
          <input
            type="range"
            min="0.1"
            max="0.9"
            step="0.1"
            value={minSimilarity}
            onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-sm text-gray-600 mt-1">
            Lower = more results (less relevant), Higher = fewer results (more relevant)
          </div>
        </div>
      )}

      {/* Search Input */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="검색어를 입력하세요..."
          className="flex-1 px-4 py-2 border rounded"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? '검색 중...' : '검색'}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Results */}
      {results && (
        <div>
          <div className="mb-4 text-gray-600">
            Found {results.total} results for "{results.query}"
            {mode === 'semantic' && ` (similarity ≥ ${minSimilarity})`}
          </div>

          <div className="space-y-4">
            {results.articles.map((article) => (
              <div key={article.id} className="border rounded p-4 hover:shadow-lg transition">
                {/* Similarity Score Badge (semantic search only) */}
                {mode === 'semantic' && article.similarity_score && (
                  <div className="mb-2">
                    <span
                      className={`inline-block px-2 py-1 rounded text-sm font-semibold ${
                        article.similarity_score >= 0.7
                          ? 'bg-green-100 text-green-800'
                          : article.similarity_score >= 0.5
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {(article.similarity_score * 100).toFixed(0)}% match
                    </span>
                  </div>
                )}

                {/* Article Content */}
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xl font-semibold text-blue-600 hover:underline"
                >
                  {article.title}
                </a>

                <div className="mt-2 text-sm text-gray-600">
                  {article.source} • {new Date(article.publishedAt).toLocaleString('ko-KR')}
                </div>

                {article.snippet && (
                  <p className="mt-2 text-gray-700">{article.snippet}</p>
                )}

                {article.thumbnail && (
                  <img
                    src={article.thumbnail}
                    alt={article.title}
                    className="mt-2 max-w-xs rounded"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

### 2. Simple API Hook

```typescript
// hooks/useNewsSearch.ts
import { useState } from 'react';

interface SearchOptions {
  mode: 'keyword' | 'semantic';
  minSimilarity?: number;
  num?: number;
}

export function useNewsSearch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (query: string, options: SearchOptions) => {
    setLoading(true);
    setError(null);

    try {
      const endpoint = options.mode === 'semantic'
        ? '/api/news/semantic-search'
        : '/api/news/search';

      const body = {
        q: query,
        num: options.num || 50,
        ...(options.mode === 'semantic' && {
          min_similarity: options.minSimilarity || 0.3
        })
      };

      const response = await fetch(`http://localhost:8000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { search, loading, error };
}
```

### 3. Usage in a Page Component

```typescript
// app/page.tsx
import NewsSearch from '@/components/NewsSearch';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8">
        <h1 className="text-4xl font-bold text-center mb-8">
          뉴스 검색
        </h1>
        <NewsSearch />
      </div>
    </main>
  );
}
```

## Vanilla JavaScript Example

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Semantic News Search</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .search-mode { margin-bottom: 20px; }
        .search-mode button { padding: 10px 20px; margin-right: 10px; cursor: pointer; }
        .search-mode button.active { background-color: #007bff; color: white; }
        #searchInput { width: 70%; padding: 10px; font-size: 16px; }
        #searchBtn { padding: 10px 20px; font-size: 16px; cursor: pointer; }
        .article { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .similarity-badge { background-color: #28a745; color: white; padding: 5px 10px; border-radius: 3px; }
        .loading { color: #666; }
    </style>
</head>
<body>
    <h1>뉴스 검색</h1>

    <div class="search-mode">
        <button id="keywordBtn" onclick="setMode('keyword')">Keyword Search</button>
        <button id="semanticBtn" class="active" onclick="setMode('semantic')">Semantic Search</button>
    </div>

    <div>
        <input type="text" id="searchInput" placeholder="검색어 입력...">
        <button id="searchBtn" onclick="performSearch()">검색</button>
    </div>

    <div id="results"></div>

    <script>
        let searchMode = 'semantic';

        function setMode(mode) {
            searchMode = mode;
            document.getElementById('keywordBtn').classList.toggle('active', mode === 'keyword');
            document.getElementById('semanticBtn').classList.toggle('active', mode === 'semantic');
        }

        async function performSearch() {
            const query = document.getElementById('searchInput').value;
            if (!query) return;

            const resultsDiv = document.getElementById('results');
            resultsDiv.innerHTML = '<p class="loading">검색 중...</p>';

            try {
                const endpoint = searchMode === 'semantic'
                    ? 'http://localhost:8000/api/news/semantic-search'
                    : 'http://localhost:8000/api/news/search';

                const body = searchMode === 'semantic'
                    ? { q: query, num: 20, min_similarity: 0.3 }
                    : { q: query, num: 20 };

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                const data = await response.json();
                displayResults(data);
            } catch (error) {
                resultsDiv.innerHTML = `<p style="color: red;">오류: ${error.message}</p>`;
            }
        }

        function displayResults(data) {
            const resultsDiv = document.getElementById('results');

            if (data.articles.length === 0) {
                resultsDiv.innerHTML = '<p>검색 결과가 없습니다.</p>';
                return;
            }

            let html = `<p>검색 결과: ${data.total}개</p>`;

            data.articles.forEach(article => {
                html += `
                    <div class="article">
                        ${searchMode === 'semantic' && article.similarity_score
                            ? `<span class="similarity-badge">${(article.similarity_score * 100).toFixed(0)}% 일치</span>`
                            : ''}
                        <h3><a href="${article.url}" target="_blank">${article.title}</a></h3>
                        <p><small>${article.source} • ${new Date(article.publishedAt).toLocaleString('ko-KR')}</small></p>
                        ${article.snippet ? `<p>${article.snippet}</p>` : ''}
                    </div>
                `;
            });

            resultsDiv.innerHTML = html;
        }

        // Allow Enter key to search
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch();
        });
    </script>
</body>
</html>
```

## API Client Examples

### Axios (JavaScript/TypeScript)

```typescript
import axios from 'axios';

const API_BASE = 'http://localhost:8000';

// Semantic search
async function semanticSearch(query: string, minSimilarity = 0.3) {
  const response = await axios.post(`${API_BASE}/api/news/semantic-search`, {
    q: query,
    num: 50,
    min_similarity: minSimilarity
  });
  return response.data;
}

// Keyword search
async function keywordSearch(query: string) {
  const response = await axios.post(`${API_BASE}/api/news/search`, {
    q: query,
    num: 50
  });
  return response.data;
}

// Usage
const results = await semanticSearch('인공지능', 0.4);
console.log(`Found ${results.total} articles`);
results.articles.forEach(article => {
  console.log(`[${article.similarity_score.toFixed(2)}] ${article.title}`);
});
```

### Fetch (JavaScript)

```javascript
async function searchNews(query, mode = 'semantic', options = {}) {
  const endpoint = mode === 'semantic'
    ? 'http://localhost:8000/api/news/semantic-search'
    : 'http://localhost:8000/api/news/search';

  const body = {
    q: query,
    num: options.num || 50,
    ...(mode === 'semantic' && {
      min_similarity: options.minSimilarity || 0.3
    })
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

// Usage
searchNews('환경 보호', 'semantic', { minSimilarity: 0.5 })
  .then(data => console.log(data))
  .catch(err => console.error(err));
```

## Environment Configuration

### .env.local (Next.js)

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Usage

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const response = await fetch(`${API_URL}/api/news/semantic-search`, {
  // ...
});
```

## Best Practices

1. **Show Loading State**: Always indicate when a search is in progress
2. **Handle Errors Gracefully**: Display user-friendly error messages
3. **Visualize Similarity Scores**: Use badges, colors, or progress bars
4. **Debounce Input**: Wait for user to stop typing before searching
5. **Cache Results**: Store recent searches to avoid redundant API calls
6. **Progressive Enhancement**: Fall back to keyword search if semantic fails

## Styling the Similarity Score

```typescript
function getSimilarityColor(score: number): string {
  if (score >= 0.8) return 'bg-green-500';
  if (score >= 0.6) return 'bg-blue-500';
  if (score >= 0.4) return 'bg-yellow-500';
  return 'bg-gray-500';
}

function getSimilarityLabel(score: number): string {
  if (score >= 0.8) return '매우 관련성 높음';
  if (score >= 0.6) return '관련성 높음';
  if (score >= 0.4) return '관련성 보통';
  return '약간 관련';
}

// In component
<span className={`px-2 py-1 rounded ${getSimilarityColor(article.similarity_score)}`}>
  {getSimilarityLabel(article.similarity_score)}
</span>
```

## Complete TypeScript Types

```typescript
// types/news.ts
export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  snippet?: string;
  thumbnail?: string;
}

export interface NewsArticleWithScore extends NewsArticle {
  similarity_score: number;
}

export interface KeywordSearchRequest {
  q: string;
  hl?: string;
  gl?: string;
  num?: number;
}

export interface SemanticSearchRequest extends KeywordSearchRequest {
  min_similarity?: number;
}

export interface SearchResponse<T = NewsArticle> {
  articles: T[];
  total: number;
  query: string;
}

export type KeywordSearchResponse = SearchResponse<NewsArticle>;
export type SemanticSearchResponse = SearchResponse<NewsArticleWithScore>;
```

This integration guide should help you quickly add the semantic search feature to any frontend framework!
