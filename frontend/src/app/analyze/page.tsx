'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { NewsApiService } from '@/services/newsApi';
import type { NewsAnalysisResponse, AnalysisType, ArticleWithSentiment, SentimentType, SentimentAnalysis, NewsArticle } from '@/types/news';
import styles from './analyze.module.css';
import Link from 'next/link';

export default function AnalyzePage() {
  const [query, setQuery] = useState('');
  const [analysisType, setAnalysisType] = useState<AnalysisType>('comprehensive');
  const [numArticles, setNumArticles] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<NewsAnalysisResponse | null>(null);
  const [excludedSources, setExcludedSources] = useState<Set<string>>(new Set());

  // 감성 필터 관련 state
  const [sentimentFilter, setSentimentFilter] = useState<Set<SentimentType>>(
    new Set(['positive', 'negative', 'neutral'])
  );
  const [articlesWithSentiment, setArticlesWithSentiment] = useState<ArticleWithSentiment[]>([]);
  const [sentimentCounts, setSentimentCounts] = useState({
    positive: 0,
    negative: 0,
    neutral: 0
  });

  useEffect(() => {
    // Load excluded sources from localStorage
    const savedExcludedSources = localStorage.getItem('excludedSources');
    if (savedExcludedSources) {
      try {
        const parsed = JSON.parse(savedExcludedSources);
        if (Array.isArray(parsed)) {
          setExcludedSources(new Set(parsed));
        }
      } catch (e) {
        console.error('Failed to load excluded sources:', e);
      }
    }
  }, []);

  // 감성 분류 함수 (클라이언트 사이드)
  const classifyArticlesBySentiment = useCallback((
    articles: NewsArticle[],
    sentiment: SentimentAnalysis | null
  ): ArticleWithSentiment[] => {
    if (!sentiment || !articles || articles.length === 0) {
      return articles.map(a => ({
        ...a,
        sentiment: 'neutral' as SentimentType,
        sentimentScore: 0,
        matchedKeywords: []
      }));
    }

    // 키워드 추출 함수
    const extractKeywords = (text: string): string[] => {
      if (!text) return [];
      return text
        .split(/\s+/)
        .filter(w => w.length >= 2)
        .filter((word, index, self) => self.indexOf(word) === index); // 중복 제거
    };

    // 긍정/부정 키워드 추출
    const positiveKeywords = extractKeywords(
      (sentiment.positive_aspects || []).join(' ')
    );
    const negativeKeywords = extractKeywords(
      (sentiment.negative_aspects || []).join(' ')
    );

    return articles.map(article => {
      const text = `${article.title} ${article.snippet || ''}`.toLowerCase();

      // 키워드 매칭 점수 계산
      const positiveScore = positiveKeywords.filter(k =>
        text.includes(k.toLowerCase())
      ).length;

      const negativeScore = negativeKeywords.filter(k =>
        text.includes(k.toLowerCase())
      ).length;

      // 감성 분류
      if (positiveScore > negativeScore && positiveScore > 0) {
        return {
          ...article,
          sentiment: 'positive' as SentimentType,
          sentimentScore: positiveScore,
          matchedKeywords: positiveKeywords
        };
      } else if (negativeScore > positiveScore && negativeScore > 0) {
        return {
          ...article,
          sentiment: 'negative' as SentimentType,
          sentimentScore: negativeScore,
          matchedKeywords: negativeKeywords
        };
      } else {
        return {
          ...article,
          sentiment: 'neutral' as SentimentType,
          sentimentScore: 0,
          matchedKeywords: []
        };
      }
    });
  }, []);

  // 필터링된 기사 계산
  const filteredArticles = useMemo(() => {
    return articlesWithSentiment.filter(article =>
      sentimentFilter.has(article.sentiment)
    );
  }, [articlesWithSentiment, sentimentFilter]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!query.trim()) {
      setError('검색어를 입력해주세요');
      return;
    }

    setLoading(true);
    setError('');
    setAnalysis(null);

    try {
      const result = await NewsApiService.analyzeNews({
        q: query,
        hl: 'ko',
        gl: 'kr',
        num: numArticles,
        analysis_type: analysisType,
        excluded_sources: Array.from(excludedSources),
      });

      setAnalysis(result);

      // 분석 완료 후 감성 분류 실행
      // 임시로 빈 배열을 사용 (실제로는 API에서 articles를 반환하지 않음)
      // 감성 분류는 분석 결과의 aspects 기반으로만 표시
      const dummyArticles: NewsArticle[] = [];
      const classified = classifyArticlesBySentiment(dummyArticles, result.sentiment);
      setArticlesWithSentiment(classified);

      // 감성별 개수 계산
      const counts = classified.reduce(
        (acc, article) => {
          acc[article.sentiment]++;
          return acc;
        },
        { positive: 0, negative: 0, neutral: 0 }
      );
      setSentimentCounts(counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const getSentimentEmoji = (sentiment: string) => {
    switch (sentiment.toLowerCase()) {
      case 'positive': return '🟢';
      case 'negative': return '🔴';
      case 'neutral': return '🟡';
      default: return '⚪';
    }
  };

  const getSentimentColor = (score: number) => {
    if (score > 0.3) return '#4caf50';
    if (score < -0.3) return '#f44336';
    return '#ff9800';
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <Link href="/" className={styles.backLink}>← 검색으로 돌아가기</Link>
          <div className={styles.titleWithTooltip}>
            <h1>🤖 AI 뉴스 분석</h1>
            <div className={styles.tooltipWrapper}>
              <span className={styles.helpIcon}>?</span>
              <div className={styles.tooltip}>
                <h4>AI 뉴스 분석이란?</h4>
                <p><strong>데이터 소스:</strong> Google News, Naver, RSS 피드 (32개 언론사)</p>
                <p><strong>분석 엔진:</strong> Cerebras LLM (초고속 AI 모델)</p>
                <p><strong>분석 방법:</strong></p>
                <ul>
                  <li>최신 뉴스 기사 수집 및 중복 제거</li>
                  <li>AI가 기사 내용을 읽고 패턴 파악</li>
                  <li>감성, 트렌드, 핵심 정보 추출</li>
                  <li>한국어로 종합 분석 결과 생성</li>
                </ul>
                <p><strong>소요 시간:</strong> 약 30초 ~ 2분</p>
              </div>
            </div>
          </div>
          <p>Cerebras LLM으로 뉴스를 심층 분석합니다</p>
        </div>
      </header>

      <main className={styles.main}>
        <form onSubmit={handleAnalyze} className={styles.analysisForm}>
          <div className={styles.formGroup}>
            <label htmlFor="query">분석할 주제</label>
            <input
              id="query"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 인공지능, 경제 동향, 기후 변화..."
              className={styles.input}
              disabled={loading}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="analysisType">분석 유형</label>
              <select
                id="analysisType"
                value={analysisType}
                onChange={(e) => setAnalysisType(e.target.value as AnalysisType)}
                className={styles.select}
                disabled={loading}
              >
                <option value="comprehensive">종합 분석 (추천)</option>
                <option value="sentiment">감성 분석</option>
                <option value="trend">트렌드 분석</option>
                <option value="key_points">핵심 포인트</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="numArticles">분석할 기사 수</label>
              <select
                id="numArticles"
                value={numArticles}
                onChange={(e) => setNumArticles(Number(e.target.value))}
                className={styles.select}
                disabled={loading}
              >
                <option value={10}>10개</option>
                <option value={15}>15개</option>
                <option value={20}>20개 (추천)</option>
                <option value={30}>30개</option>
                <option value={50}>50개</option>
              </select>
            </div>
          </div>

          <div className={styles.analysisTypeInfo}>
            {analysisType === 'comprehensive' && (
              <p>💡 종합 분석: 감성, 트렌드, 핵심 포인트를 모두 포함한 완전한 분석</p>
            )}
            {analysisType === 'sentiment' && (
              <p>💡 감성 분석: 뉴스의 긍정/부정 측면과 전반적인 감성 파악</p>
            )}
            {analysisType === 'trend' && (
              <p>💡 트렌드 분석: 주요 토픽, 신흥 트렌드, 핵심 인물/기관 파악</p>
            )}
            {analysisType === 'key_points' && (
              <p>💡 핵심 포인트: 가장 중요한 정보만 간결하게 추출</p>
            )}
          </div>

          <button
            type="submit"
            className={styles.analyzeButton}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner}></span>
                분석 중... (최대 2분 소요)
              </>
            ) : (
              '🔍 분석 시작'
            )}
          </button>
        </form>

        {error && (
          <div className={styles.error}>
            ❌ {error}
          </div>
        )}

        {analysis && (
          <div className={styles.results}>
            <div className={styles.resultHeader}>
              <h2>분석 결과</h2>
              <div className={styles.resultMeta}>
                <span className={styles.badge}>{analysis.analysis_type}</span>
                <span className={styles.meta}>
                  📊 {analysis.articles_analyzed}개 기사 분석
                </span>
                <span className={styles.meta}>
                  🕐 {new Date(analysis.generated_at).toLocaleString('ko-KR')}
                </span>
              </div>
            </div>

            {/* 요약 */}
            <div className={styles.section}>
              <h3>📋 요약</h3>
              <p className={styles.summary}>{analysis.summary}</p>
            </div>

            {/* 핵심 포인트 */}
            <div className={styles.section}>
              <h3>🎯 핵심 포인트</h3>
              <ul className={styles.keyPoints}>
                {analysis.key_points.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </div>

            {/* 감성 분석 */}
            {analysis.sentiment && (
              <div className={styles.section}>
                <h3>💭 감성 분석</h3>
                <div className={styles.sentimentCard}>
                  <div className={styles.sentimentHeader}>
                    <span className={styles.sentimentEmoji}>
                      {getSentimentEmoji(analysis.sentiment.overall_sentiment)}
                    </span>
                    <div>
                      <div className={styles.sentimentLabel}>
                        전반적 감성: <strong>{analysis.sentiment.overall_sentiment}</strong>
                      </div>
                      <div className={styles.sentimentScore}>
                        <div className={styles.scoreBar}>
                          <div
                            className={styles.scoreBarFill}
                            style={{
                              width: `${Math.abs(analysis.sentiment.sentiment_score) * 50 + 50}%`,
                              backgroundColor: getSentimentColor(analysis.sentiment.sentiment_score),
                              marginLeft: analysis.sentiment.sentiment_score < 0 ? 'auto' : '0',
                            }}
                          />
                        </div>
                        <span className={styles.scoreValue}>
                          {analysis.sentiment.sentiment_score.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.aspectsGrid}>
                    <div className={styles.aspectCard}>
                      <h4>✅ 긍정적 측면</h4>
                      <ul>
                        {analysis.sentiment.positive_aspects.map((aspect, index) => (
                          <li key={index}>{aspect}</li>
                        ))}
                      </ul>
                    </div>
                    <div className={styles.aspectCard}>
                      <h4>⚠️ 부정적 측면</h4>
                      <ul>
                        {analysis.sentiment.negative_aspects.map((aspect, index) => (
                          <li key={index}>{aspect}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 트렌드 분석 */}
            {analysis.trends && (
              <div className={styles.section}>
                <h3>📈 트렌드 분석</h3>
                <div className={styles.trendsGrid}>
                  <div className={styles.trendCard}>
                    <h4>🏷️ 주요 토픽</h4>
                    <div className={styles.tags}>
                      {analysis.trends.main_topics.map((topic, index) => (
                        <span key={index} className={styles.tag}>{topic}</span>
                      ))}
                    </div>
                  </div>
                  <div className={styles.trendCard}>
                    <h4>🚀 신흥 트렌드</h4>
                    <div className={styles.tags}>
                      {analysis.trends.emerging_trends.map((trend, index) => (
                        <span key={index} className={styles.tag}>{trend}</span>
                      ))}
                    </div>
                  </div>
                  <div className={styles.trendCard}>
                    <h4>👥 핵심 인물/기관</h4>
                    <div className={styles.tags}>
                      {analysis.trends.key_entities.map((entity, index) => (
                        <span key={index} className={styles.tag}>{entity}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
