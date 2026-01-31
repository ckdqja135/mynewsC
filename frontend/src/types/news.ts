export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string | null;
  thumbnail: string | null;
}

export interface NewsArticleWithScore extends NewsArticle {
  similarity_score: number;
}

export interface NewsSearchRequest {
  q: string;
  hl?: string;
  gl?: string;
  num?: number;
}

export interface SemanticSearchRequest extends NewsSearchRequest {
  min_similarity?: number;
}

export interface NewsSearchResponse {
  articles: NewsArticle[];
  total: number;
  query: string;
}

export interface SemanticSearchResponse {
  articles: NewsArticleWithScore[];
  total: number;
  query: string;
}

export interface ApiError {
  error: string;
  message?: string;
  detail?: string;
}

export type SearchMode = 'keyword' | 'semantic';
