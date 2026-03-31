import axios, { AxiosError } from 'axios';
import type {
  NewsSearchRequest,
  NewsSearchResponse,
  SemanticSearchRequest,
  SemanticSearchResponse,
  NewsAnalysisRequest,
  NewsAnalysisResponse,
  FeedbackRequest,
  FeedbackResponse,
  LarkConfig,
  LarkSendRequest,
  LarkSendResponse,
  ApiError
} from '@/types/news';

// Use Next.js API proxy to avoid CORS issues (HTTPS -> HTTP)
const API_BASE_URL = '/api/proxy';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export class NewsApiService {
  // 키워드 검색 (기존)
  static async searchNews(params: NewsSearchRequest): Promise<NewsSearchResponse> {
    try {
      const response = await apiClient.post<NewsSearchResponse>('/news/search', params, {
        timeout: 120000, // 2분 (복수 키워드 검색 시 시간 소요)
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiError>;

        if (axiosError.response) {
          const errorData = axiosError.response.data;
          const errorMessage =
            errorData?.message ||
            errorData?.detail ||
            errorData?.error ||
            'Failed to fetch news';

          throw new Error(errorMessage);
        } else if (axiosError.request) {
          throw new Error('No response from server. Please check your connection.');
        }
      }

      throw new Error('An unexpected error occurred');
    }
  }

  // 시맨틱 검색 (새로 추가)
  static async semanticSearchNews(params: SemanticSearchRequest): Promise<SemanticSearchResponse> {
    try {
      const response = await apiClient.post<SemanticSearchResponse>('/news/semantic-search', params, {
        timeout: 300000, // 5분 (복수 키워드 시 대량 기사 임베딩에 시간 소요)
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiError>;

        if (axiosError.response) {
          const errorData = axiosError.response.data;
          const errorMessage =
            errorData?.message ||
            errorData?.detail ||
            errorData?.error ||
            'Failed to fetch news';

          throw new Error(errorMessage);
        } else if (axiosError.request) {
          throw new Error('No response from server. Please check your connection.');
        }
      }

      throw new Error('An unexpected error occurred');
    }
  }

  // LLM 뉴스 분석
  static async analyzeNews(params: NewsAnalysisRequest): Promise<NewsAnalysisResponse> {
    try {
      const response = await apiClient.post<NewsAnalysisResponse>(
        '/news/analyze',
        params,
        {
          timeout: 300000, // 5분 (LLM 분석은 시간이 더 걸릴 수 있음)
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiError>;

        if (axiosError.response) {
          const errorData = axiosError.response.data;
          const errorMessage =
            errorData?.message ||
            errorData?.detail ||
            errorData?.error ||
            'Failed to analyze news';

          throw new Error(errorMessage);
        } else if (axiosError.request) {
          throw new Error('No response from server. Please check your connection.');
        }
      }

      throw new Error('An unexpected error occurred');
    }
  }

  // LLM 기반 감성 분류
  static async classifySentiment(articles: any[], query: string, sentimentTypes?: string[]): Promise<any> {
    try {
      const response = await apiClient.post(
        '/news/classify-sentiment',
        {
          articles,
          query,
          sentimentTypes // 감성 타입 필터 추가
        },
        { timeout: 300000 } // 5분 (LLM 배치 처리 시간 고려)
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiError>;

        if (axiosError.response) {
          const errorData = axiosError.response.data;
          const errorMessage =
            errorData?.message ||
            errorData?.detail ||
            errorData?.error ||
            'Failed to classify sentiment';

          throw new Error(errorMessage);
        } else if (axiosError.request) {
          throw new Error('No response from server. Please check your connection.');
        }
      }

      throw new Error('An unexpected error occurred');
    }
  }

  // 감성 키워드 조회
  static async getKeywordSettings(): Promise<{ positive: string[]; negative: string[]; defaults: { positive: string[]; negative: string[] } }> {
    try {
      const response = await apiClient.get('/sentiment/keywords');
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiError>;
        if (axiosError.response) {
          const errorData = axiosError.response.data;
          throw new Error(errorData?.detail || 'Failed to get keyword settings');
        }
      }
      throw new Error('Failed to get keyword settings');
    }
  }

  // 감성 키워드 저장
  static async saveKeywordSettings(config: { positive: string[]; negative: string[] }): Promise<{ status: string; positive: string[]; negative: string[] }> {
    try {
      const response = await apiClient.put('/sentiment/keywords', config);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiError>;
        if (axiosError.response) {
          const errorData = axiosError.response.data;
          throw new Error(errorData?.detail || 'Failed to save keyword settings');
        }
      }
      throw new Error('Failed to save keyword settings');
    }
  }

  // 피드백 제출 (Phase 3)
  static async submitFeedback(params: FeedbackRequest): Promise<FeedbackResponse> {
    const response = await apiClient.post<FeedbackResponse>('/feedback/submit', params);
    return response.data;
  }

  static async healthCheck(): Promise<{ status: string }> {
    const response = await apiClient.get('/health');
    return response.data;
  }

  // Lark 수동 전송
  static async sendLarkManual(params: LarkSendRequest): Promise<LarkSendResponse> {
    try {
      const response = await apiClient.post<LarkSendResponse>(
        '/lark/send-manual',
        params,
        { timeout: 60000 } // 1분
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiError>;

        if (axiosError.response) {
          const errorData = axiosError.response.data;
          const errorMessage =
            errorData?.message ||
            errorData?.detail ||
            errorData?.error ||
            'Failed to send Lark message';

          throw new Error(errorMessage);
        } else if (axiosError.request) {
          throw new Error('No response from server. Please check your connection.');
        }
      }

      throw new Error('An unexpected error occurred');
    }
  }

  // Lark 스케줄 저장
  static async saveLarkSchedule(config: LarkConfig): Promise<{ success: boolean; jobId: string }> {
    try {
      const response = await apiClient.post<{ success: boolean; jobId: string }>(
        '/lark/schedule-config',
        config
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiError>;

        if (axiosError.response) {
          const errorData = axiosError.response.data;
          const errorMessage =
            errorData?.message ||
            errorData?.detail ||
            errorData?.error ||
            'Failed to save Lark schedule';

          throw new Error(errorMessage);
        }
      }

      throw new Error('Failed to save Lark schedule');
    }
  }

  // Lark 스케줄 조회
  static async getLarkSchedule(): Promise<LarkConfig | null> {
    try {
      const response = await apiClient.get<LarkConfig>('/lark/schedule-config');
      return response.data.enabled ? response.data : null;
    } catch (error) {
      console.error('Failed to get Lark schedule:', error);
      return null;
    }
  }

  // Lark 스케줄 삭제
  static async deleteLarkSchedule(): Promise<{ success: boolean }> {
    try {
      const response = await apiClient.delete<{ success: boolean }>('/lark/schedule-config');
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<ApiError>;

        if (axiosError.response) {
          const errorData = axiosError.response.data;
          const errorMessage =
            errorData?.message ||
            errorData?.detail ||
            errorData?.error ||
            'Failed to delete Lark schedule';

          throw new Error(errorMessage);
        }
      }

      throw new Error('Failed to delete Lark schedule');
    }
  }
}
