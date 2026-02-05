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

// LLM Analysis Types
export type AnalysisType = 'comprehensive' | 'sentiment' | 'trend' | 'key_points';

export interface SentimentAnalysis {
  overall_sentiment: string;
  sentiment_score: number;
  positive_aspects: string[];
  negative_aspects: string[];
}

export interface TrendAnalysis {
  main_topics: string[];
  emerging_trends: string[];
  key_entities: string[];
}

export interface NewsAnalysisRequest {
  q: string;
  hl?: string;
  gl?: string;
  num?: number;
  analysis_type?: AnalysisType;
  days_back?: number;
}

export interface NewsAnalysisResponse {
  query: string;
  analysis_type: string;
  articles_analyzed: number;
  summary: string;
  key_points: string[];
  sentiment: SentimentAnalysis | null;
  trends: TrendAnalysis | null;
  generated_at: string;
}
