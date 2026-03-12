export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string | null;
  thumbnail: string | null;
  matchedKeyword?: string;
}

export interface NewsArticleWithScore extends NewsArticle {
  similarity_score: number;
}

export interface NewsSearchRequest {
  q: string;
  hl?: string;
  gl?: string;
  num?: number;
  excluded_sources?: string[];
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
  excluded_sources?: string[];
  articles?: NewsArticle[] | NewsArticleWithScore[]; // 필터링된 기사 전달 가능
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

// 감성 타입
export type SentimentType = 'positive' | 'negative' | 'neutral';

// 감성이 태그된 기사
export interface ArticleWithSentiment extends NewsArticle {
  sentiment: SentimentType;
  sentimentScore: number;
  matchedKeywords: string[];
}

// Lark 설정
export interface LarkConfig {
  enabled: boolean;
  schedule: string; // cron expression
  webhookUrl: string;
  query: string;
  sentimentTypes: SentimentType[];
  num: number;
  excluded_sources: string[];
}

// Lark 수동 전송 요청
export interface LarkSendRequest {
  webhookUrl: string;
  query: string;
  sentimentTypes: SentimentType[];
  num?: number;
  excluded_sources?: string[];
}

// Lark 전송 응답
export interface LarkSendResponse {
  success: boolean;
  message: string;
  articlesSent: number;
  totalArticles: number;
  timestamp: string;
}
