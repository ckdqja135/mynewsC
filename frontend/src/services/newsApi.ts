import axios, { AxiosError } from 'axios';
import type {
  NewsSearchRequest,
  NewsSearchResponse,
  SemanticSearchRequest,
  SemanticSearchResponse,
  NewsAnalysisRequest,
  NewsAnalysisResponse,
  ApiError
} from '@/types/news';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
      const response = await apiClient.post<NewsSearchResponse>('/api/news/search', params);
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
      const response = await apiClient.post<SemanticSearchResponse>('/api/news/semantic-search', params);
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
        '/api/news/analyze',
        params,
        {
          timeout: 120000, // 2분 (LLM 분석은 시간이 더 걸릴 수 있음)
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

  static async healthCheck(): Promise<{ status: string }> {
    const response = await apiClient.get('/health');
    return response.data;
  }
}
