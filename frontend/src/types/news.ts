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

export interface AnalysisSource {
  title: string;
  url: string;
  score: number;
  press?: string | null;       // 언론사 (P2)
  publishedAt?: string | null; // 발행 시각 (P2)
  usedChunks?: number;         // 이 기사에서 근거로 쓰인 청크 수 (P2)
}

// 분석 대상/제외 카운트 (P2)
export interface AnalysisStats {
  collected: number;       // 수집한 기사 수
  afterDedup: number;      // 중복 제거 후
  afterDateFilter: number; // 기간 필터 후
  candidates: number;      // 분석 후보(num 제한)
  bodyFetched: number;     // 본문 확보
  bodyFailed: number;      // 본문 실패
  contextArticles: number; // 실제 근거로 반영된 기사 수
}

export interface NewsAnalysisResponse {
  query: string;
  analysis_type: string;
  articles_analyzed: number;
  confidence_score: number | null;
  sources: AnalysisSource[] | null;
  summary: string;
  key_points: string[];
  sentiment: SentimentAnalysis | null;
  trends: TrendAnalysis | null;
  generated_at: string;
  stats?: AnalysisStats;       // P2
  limitations?: string[];      // P2
}

export interface FeedbackRequest {
  articleId: string;
  feedback: 'like' | 'dislike';
}

export interface FeedbackResponse {
  articleId: string;
  likes: number;
  dislikes: number;
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

// Telegram 설정
export interface TelegramConfig {
  enabled: boolean;
  schedule: string; // cron expression
  botToken: string;
  chatId: string;
  query: string;
  sentimentTypes: SentimentType[];
  num: number;
  excluded_sources: string[];
  // backend/.env에 크리덴셜이 있는지 여부 (실제 값은 전달되지 않음)
  hasEnvBotToken?: boolean;
  hasEnvChatId?: boolean;
}

// Telegram 수동 전송 요청
export interface TelegramSendRequest {
  botToken: string;
  chatId: string;
  query: string;
  sentimentTypes: SentimentType[];
  num?: number;
  excluded_sources?: string[];
}

// Telegram 전송 응답
export interface TelegramSendResponse {
  success: boolean;
  message: string;
  articlesSent: number;
  totalArticles: number;
  timestamp: string;
}

// 실시간 핫 키워드 알림 소스
export type TrendingSource = 'auto' | 'signal' | 'google';

// 실시간 인기 키워드 아이템 (백엔드 trendingService 정규화 형식 — 텔레그램 알림과 동일)
export interface TrendingKeywordItem {
  rank: number;
  keyword: string;
  state: string | null;
  stateEmoji: string;
  stateLabel: string;
  traffic: string | null;
  // categorize=1로 요청 시 백엔드가 LLM으로 부여하는 카테고리 (정치/경제/사회/...)
  category?: string | null;
}

// 실시간 인기 키워드 조회 응답 (GET /api/trending)
export interface TrendingResponse {
  source: string;
  fetchedAt: string;
  count: number;
  items: TrendingKeywordItem[];
}

// 실시간 핫 키워드 알림 설정 (뉴스 다이제스트와 독립된 별도 스케줄)
export interface TrendingConfig {
  enabled: boolean;
  schedule: string; // cron expression
  source: TrendingSource;
  limit: number; // 전송할 키워드 개수 (1~20)
  botToken: string;
  chatId: string;
  // backend/.env에 크리덴셜이 있는지 여부 (실제 값은 전달되지 않음)
  hasEnvBotToken?: boolean;
  hasEnvChatId?: boolean;
}

// 실시간 핫 키워드 수동 전송 요청
export interface TrendingSendRequest {
  botToken: string;
  chatId: string;
  source?: TrendingSource;
  limit?: number;
}

// 실시간 핫 키워드 수동 전송 응답
export interface TrendingSendResponse {
  success: boolean;
  message: string;
  source: string;
  count: number;
  timestamp: string;
}
