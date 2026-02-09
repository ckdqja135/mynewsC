'use client';

import { useState, useEffect, useMemo } from 'react';
import { NewsApiService } from '@/services/newsApi';
import type { NewsArticle, NewsArticleWithScore, SearchMode, NewsAnalysisResponse } from '@/types/news';
import styles from './page.module.css';
import Link from 'next/link';

type ViewMode = 'list' | 'grid';
type SortOrder = 'desc' | 'asc';
type Theme = 'light' | 'dark';

// 언론사 목록
const NEWS_SOURCES = [
  // 한국 언론사
  { id: 'google_news', name: 'Google News', category: '검색엔진' },
  { id: 'naver', name: 'Naver 뉴스', category: '검색엔진' },
  { id: '연합뉴스', name: '연합뉴스', category: '한국' },
  { id: 'KBS', name: 'KBS', category: '한국' },
  { id: 'MBC', name: 'MBC', category: '한국' },
  { id: 'SBS', name: 'SBS', category: '한국' },
  { id: 'JTBC', name: 'JTBC', category: '한국' },
  // 미국 언론사
  { id: 'CNN', name: 'CNN', category: '미국' },
  { id: 'CNN World', name: 'CNN World', category: '미국' },
  { id: 'CNN US', name: 'CNN US', category: '미국' },
  { id: 'CNN Tech', name: 'CNN Tech', category: '미국' },
  { id: 'ABC News', name: 'ABC News', category: '미국' },
  { id: 'CBS News', name: 'CBS News', category: '미국' },
  { id: 'NPR', name: 'NPR', category: '미국' },
  { id: 'USA Today', name: 'USA Today', category: '미국' },
  { id: 'Politico', name: 'Politico', category: '미국' },
  // 영국 언론사
  { id: 'BBC World', name: 'BBC World', category: '영국' },
  { id: 'BBC Business', name: 'BBC Business', category: '영국' },
  { id: 'BBC Tech', name: 'BBC Tech', category: '영국' },
  { id: 'BBC Science', name: 'BBC Science', category: '영국' },
  { id: 'The Guardian', name: 'The Guardian', category: '영국' },
  { id: 'The Guardian Tech', name: 'The Guardian Tech', category: '영국' },
  // 통신사/경제
  { id: 'Reuters', name: 'Reuters', category: '통신사' },
  { id: 'Reuters World', name: 'Reuters World', category: '통신사' },
  { id: 'Reuters Business', name: 'Reuters Business', category: '통신사' },
  { id: 'Reuters Tech', name: 'Reuters Tech', category: '통신사' },
  { id: 'AP News', name: 'AP News', category: '통신사' },
  { id: 'Bloomberg', name: 'Bloomberg', category: '경제' },
  { id: 'Forbes', name: 'Forbes', category: '경제' },
  { id: 'WSJ', name: 'Wall Street Journal', category: '경제' },
  { id: 'WSJ Tech', name: 'WSJ Tech', category: '경제' },
  // 기타
  { id: 'NYTimes World', name: 'NY Times World', category: '기타' },
  { id: 'NYTimes US', name: 'NY Times US', category: '기타' },
  { id: 'NYTimes Tech', name: 'NY Times Tech', category: '기타' },
  { id: 'NYTimes Business', name: 'NY Times Business', category: '기타' },
  { id: 'Washington Post', name: 'Washington Post', category: '기타' },
  { id: 'Time', name: 'Time', category: '기타' },
];

export default function Home() {
  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState<NewsArticle[] | NewsArticleWithScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  // 검색 모드 상태 추가
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword');
  const [minSimilarity, setMinSimilarity] = useState<number>(0.3);  // 기본값 0.3 (보통)

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('light');
  const [itemsPerPage, setItemsPerPage] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1); // For grid view pagination
  const [displayedCount, setDisplayedCount] = useState<number>(20); // For list view infinite scroll

  // 성능 정보
  const [searchTime, setSearchTime] = useState<number>(0);
  const [lastSearchQuery, setLastSearchQuery] = useState<string>('');
  const [lastSearchMode, setLastSearchMode] = useState<SearchMode | null>(null);

  // 각 검색 모드별 결과 저장
  const [keywordSearchCache, setKeywordSearchCache] = useState<{
    query: string;
    articles: NewsArticle[];
    total: number;
    searchTime: number;
  } | null>(null);
  const [semanticSearchCache, setSemanticSearchCache] = useState<{
    query: string;
    articles: NewsArticleWithScore[];
    total: number;
    searchTime: number;
    analysisData: NewsAnalysisResponse | null;
  } | null>(null);

  // 검색 히스토리
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  // 북마크
  const [bookmarkedArticles, setBookmarkedArticles] = useState<Set<string>>(new Set());
  const [showBookmarksOnly, setShowBookmarksOnly] = useState<boolean>(false);

  // 날짜 필터
  const [dateFilter, setDateFilter] = useState<string>('all'); // 'all', 'today', 'week', 'month', 'custom'
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // 설정 모달
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<'auto' | 'filter'>('auto');
  const [defaultQuery, setDefaultQuery] = useState<string>('');
  const [defaultSearchMode, setDefaultSearchMode] = useState<SearchMode>('keyword');
  const [defaultMinSimilarity, setDefaultMinSimilarity] = useState<number>(0.3);
  const [autoSearchEnabled, setAutoSearchEnabled] = useState<boolean>(false);
  const [excludedSources, setExcludedSources] = useState<Set<string>>(new Set());

  // 언론사 필터 펼침/접힘
  const [showSourceFilter, setShowSourceFilter] = useState<boolean>(true);

  // AI 분석 상태
  const [analysisData, setAnalysisData] = useState<NewsAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string>('');
  const [showAnalysisPanel, setShowAnalysisPanel] = useState<boolean>(true);

  // 모바일 탭 상태 (검색 결과 / 분석 결과)
  const [mobileTab, setMobileTab] = useState<'results' | 'analysis'>('results');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    }

    // 검색 히스토리 로드
    const savedHistory = localStorage.getItem('searchHistory');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        // 배열이고 모든 요소가 문자열인지 확인
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
          setSearchHistory(parsed);
        } else {
          // 잘못된 형식이면 초기화
          localStorage.removeItem('searchHistory');
          setSearchHistory([]);
        }
      } catch (e) {
        console.error('Failed to load search history:', e);
        localStorage.removeItem('searchHistory');
        setSearchHistory([]);
      }
    }

    // 북마크 로드
    const savedBookmarks = localStorage.getItem('bookmarkedArticles');
    if (savedBookmarks) {
      try {
        const parsed = JSON.parse(savedBookmarks);
        // 배열이고 모든 요소가 문자열인지 확인
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
          setBookmarkedArticles(new Set(parsed));
        } else {
          // 잘못된 형식이면 초기화
          localStorage.removeItem('bookmarkedArticles');
          setBookmarkedArticles(new Set());
        }
      } catch (e) {
        console.error('Failed to load bookmarks:', e);
        localStorage.removeItem('bookmarkedArticles');
        setBookmarkedArticles(new Set());
      }
    }

    // 자동 검색 설정 로드
    const savedSettings = localStorage.getItem('autoSearchSettings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setAutoSearchEnabled(parsed.enabled || false);
        setDefaultQuery(parsed.query || '');
        setDefaultSearchMode(parsed.searchMode || 'keyword');
        setDefaultMinSimilarity(parsed.minSimilarity || 0.3);

        if (parsed.enabled && parsed.query) {
          // 자동 검색 실행
          setQuery(parsed.query);
          setSearchMode(parsed.searchMode || 'keyword');
          if (parsed.minSimilarity !== undefined) {
            setMinSimilarity(parsed.minSimilarity);
          }

          // 검색 실행
          setTimeout(() => {
            performSearch(parsed.query, parsed.searchMode || 'keyword');
          }, 100);
        }
      } catch (e) {
        console.error('Failed to load auto search settings:', e);
      }
    }

    // 제외할 언론사 목록 로드
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

  // 백엔드에서 필터링하므로 프론트엔드 필터링은 불필요

  const toggleBookmark = (articleId: string) => {
    setBookmarkedArticles(prev => {
      const updated = new Set(prev);
      if (updated.has(articleId)) {
        updated.delete(articleId);
      } else {
        updated.add(articleId);
      }
      localStorage.setItem('bookmarkedArticles', JSON.stringify(Array.from(updated)));
      return updated;
    });
  };

  const clearBookmarks = () => {
    setBookmarkedArticles(new Set());
    localStorage.removeItem('bookmarkedArticles');
    setShowBookmarksOnly(false);
  };

  const addToSearchHistory = (searchQuery: string) => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return;

    setSearchHistory(prev => {
      // 중복 제거 및 최신순 정렬
      const updated = [trimmedQuery, ...prev.filter(q => q !== trimmedQuery)];
      // 최대 10개까지만 저장
      const limited = updated.slice(0, 10);
      localStorage.setItem('searchHistory', JSON.stringify(limited));
      return limited;
    });
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem('searchHistory');
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const saveAutoSearchSettings = () => {
    const settings = {
      enabled: autoSearchEnabled,
      query: defaultQuery,
      searchMode: defaultSearchMode,
      minSimilarity: defaultMinSimilarity,
    };
    localStorage.setItem('autoSearchSettings', JSON.stringify(settings));

    // 제외할 언론사 저장
    localStorage.setItem('excludedSources', JSON.stringify(Array.from(excludedSources)));

    setShowSettings(false);
  };

  const performAnalysis = async (searchQuery: string) => {
    setAnalysisLoading(true);
    setAnalysisError('');
    setMobileTab('results'); // 분석 시작 시 결과 탭으로

    try {
      const response = await NewsApiService.analyzeNews({
        q: searchQuery,
        hl: 'ko',
        gl: 'kr',
        num: 100,  // Analyze up to 100 articles
        analysis_type: 'comprehensive',
        days_back: 30,  // Analyze articles from the last 30 days
        excluded_sources: Array.from(excludedSources),
      });

      setAnalysisData(response);
      setShowAnalysisPanel(true);

      // 시맨틱 검색 캐시에 분석 결과 업데이트
      setSemanticSearchCache(prev => {
        if (prev && prev.query === searchQuery) {
          return {
            ...prev,
            analysisData: response,
          };
        }
        return prev;
      });
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : '뉴스 분석에 실패했습니다');
      setAnalysisData(null);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleSearchModeChange = (mode: SearchMode) => {
    setSearchMode(mode);

    // 해당 모드의 캐시된 결과 복원
    if (mode === 'keyword' && keywordSearchCache) {
      // 일반 검색 결과 복원
      setQuery(keywordSearchCache.query); // 검색어도 복원
      setArticles(keywordSearchCache.articles);
      setTotal(keywordSearchCache.total);
      setLastSearchQuery(keywordSearchCache.query);
      setLastSearchMode('keyword');
      setSearchTime(keywordSearchCache.searchTime);
      setAnalysisData(null);
      setAnalysisError('');
    } else if (mode === 'semantic' && semanticSearchCache) {
      // AI 검색 결과 복원
      setQuery(semanticSearchCache.query); // 검색어도 복원
      setArticles(semanticSearchCache.articles);
      setTotal(semanticSearchCache.total);
      setLastSearchQuery(semanticSearchCache.query);
      setLastSearchMode('semantic');
      setSearchTime(semanticSearchCache.searchTime);
      setAnalysisData(semanticSearchCache.analysisData);
      setAnalysisError('');
    } else {
      // 캐시된 결과가 없으면 초기화
      setQuery(''); // 검색어도 초기화
      setArticles([]);
      setTotal(0);
      setLastSearchQuery('');
      setLastSearchMode(null);
      setSearchTime(0);
      setAnalysisData(null);
      setAnalysisError('');
    }
  };

  const performSearch = async (searchQuery: string, mode: SearchMode) => {
    if (!searchQuery.trim()) {
      setError('검색어를 입력해주세요');
      return;
    }

    setLoading(true);
    setError('');
    setSelectedSource(null);
    setCurrentPage(1);
    setDisplayedCount(itemsPerPage);
    setLastSearchQuery(searchQuery);
    setShowHistory(false);

    // 분석 데이터 초기화
    setAnalysisData(null);
    setAnalysisError('');

    // 검색 히스토리에 추가
    addToSearchHistory(searchQuery);

    const startTime = performance.now();

    try {
      let responseArticles: NewsArticle[] | NewsArticleWithScore[];
      let responseTotal: number;

      if (mode === 'semantic') {
        // 시맨틱 검색
        const response = await NewsApiService.semanticSearchNews({
          q: searchQuery,
          hl: 'ko',
          gl: 'kr',
          num: 500,
          min_similarity: minSimilarity,
          excluded_sources: Array.from(excludedSources),
        });

        responseArticles = response.articles;
        responseTotal = response.total;
        setArticles(response.articles);
        setTotal(response.total);

        // 시맨틱 검색 완료 후 자동으로 분석 실행
        if (response.articles.length > 0) {
          performAnalysis(searchQuery);
        }
      } else {
        // 키워드 검색
        const response = await NewsApiService.searchNews({
          q: searchQuery,
          hl: 'ko',
          gl: 'kr',
          num: 500,
          excluded_sources: Array.from(excludedSources),
        });

        responseArticles = response.articles;
        responseTotal = response.total;
        setArticles(response.articles);
        setTotal(response.total);
      }

      const endTime = performance.now();
      const elapsedTime = (endTime - startTime) / 1000;
      setSearchTime(elapsedTime);
      setLastSearchMode(mode);

      // 검색 결과를 캐시에 저장
      if (mode === 'keyword') {
        setKeywordSearchCache({
          query: searchQuery,
          articles: responseArticles as NewsArticle[],
          total: responseTotal,
          searchTime: elapsedTime,
        });
      } else {
        setSemanticSearchCache({
          query: searchQuery,
          articles: responseArticles as NewsArticleWithScore[],
          total: responseTotal,
          searchTime: elapsedTime,
          analysisData: null, // 분석은 나중에 업데이트
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '뉴스를 불러오는데 실패했습니다');
      setArticles([]);
      setTotal(0);
      setSearchTime(0);
      setLastSearchMode(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSearch(query, searchMode);
  };

  const sources = useMemo(() => {
    const sourceMap = new Map<string, number>();
    articles.forEach(article => {
      sourceMap.set(article.source, (sourceMap.get(article.source) || 0) + 1);
    });
    return Array.from(sourceMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count }));
  }, [articles]);

  const filteredAndSortedArticles = useMemo(() => {
    let result = [...articles];

    if (selectedSource) {
      result = result.filter(article => article.source === selectedSource);
    }

    if (showBookmarksOnly) {
      result = result.filter(article => bookmarkedArticles.has(article.id));
    }

    // 날짜 필터링
    if (dateFilter !== 'all') {
      const now = new Date();
      let startDate: Date | null = null;

      if (dateFilter === 'today') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (dateFilter === 'week') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (dateFilter === 'month') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (dateFilter === 'custom' && customStartDate) {
        startDate = new Date(customStartDate);
      }

      if (startDate) {
        result = result.filter(article => {
          if (!article.publishedAt) return false;
          const articleDate = new Date(article.publishedAt);

          if (dateFilter === 'custom' && customEndDate) {
            const endDate = new Date(customEndDate);
            endDate.setHours(23, 59, 59, 999);
            return articleDate >= startDate && articleDate <= endDate;
          }

          return articleDate >= startDate;
        });
      }
    }

    result.sort((a, b) => {
      if (searchMode === 'semantic') {
        // 시맨틱 검색: 유사도 점수로 정렬
        const scoreA = (a as NewsArticleWithScore).similarity_score || 0;
        const scoreB = (b as NewsArticleWithScore).similarity_score || 0;
        return sortOrder === 'desc' ? scoreB - scoreA : scoreA - scoreB;
      } else {
        // 키워드 검색: 날짜로 정렬
        const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      }
    });

    return result;
  }, [articles, selectedSource, sortOrder, searchMode, showBookmarksOnly, bookmarkedArticles, dateFilter, customStartDate, customEndDate]);

  // For list view: infinite scroll
  const infiniteScrollArticles = useMemo(() => {
    return filteredAndSortedArticles.slice(0, displayedCount);
  }, [filteredAndSortedArticles, displayedCount]);

  // For grid view: pagination
  const paginatedArticles = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredAndSortedArticles.slice(startIndex, endIndex);
  }, [filteredAndSortedArticles, currentPage, itemsPerPage]);

  const displayedArticles = viewMode === 'list' ? infiniteScrollArticles : paginatedArticles;
  const hasMore = displayedCount < filteredAndSortedArticles.length;
  const totalPages = Math.ceil(filteredAndSortedArticles.length / itemsPerPage);

  useEffect(() => {
    setDisplayedCount(itemsPerPage);
    setCurrentPage(1);
  }, [selectedSource, sortOrder, itemsPerPage]);

  // Scroll to top when changing pages in grid view
  useEffect(() => {
    if (viewMode === 'grid') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage, viewMode]);

  // Infinite scroll: load more when reaching bottom (list view only)
  useEffect(() => {
    if (viewMode !== 'list') return;

    const handleScroll = () => {
      if (loading) return;

      const scrollPosition = window.innerHeight + window.scrollY;
      const bottomPosition = document.documentElement.offsetHeight - 500;

      if (scrollPosition >= bottomPosition && hasMore) {
        setDisplayedCount(prev => prev + itemsPerPage);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [viewMode, loading, hasMore, itemsPerPage]);

  // Close search history on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showHistory) {
        const target = e.target as HTMLElement;
        if (!target.closest(`.${styles.searchInputWrapper}`)) {
          setShowHistory(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHistory]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '날짜 정보 없음';

    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '날짜 정보 없음';

      return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '날짜 정보 없음';
    }
  };

  const highlightText = (text: string, highlight: string) => {
    if (!highlight.trim()) return text;

    const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <mark key={i} className={styles.highlight}>{part}</mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  return (
    <div className={styles.container}>
      {/* 우측 상단 고정 버튼들 */}
      <div className={styles.fixedButtons}>
        <button
          className={styles.settingsButton}
          onClick={() => setShowSettings(true)}
          aria-label="설정"
          title="자동 검색 설정"
        >
          ⚙️
        </button>
        <button
          className={styles.themeToggle}
          onClick={toggleTheme}
          aria-label="테마 전환"
          title={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>

      <header className={styles.header}>
        <div className={styles.headerContent}>
          <h1>뉴스 검색</h1>
          <p>구글 뉴스에서 기사를 검색해보세요</p>
        </div>
      </header>

      <main className={styles.main}>
        {/* 통합 검색 바 */}
        <form onSubmit={handleSearch} className={styles.searchForm}>
          {/* 검색 모드 선택 */}
          <div className={styles.compactModeSelector}>
            <button
              type="button"
              className={`${styles.compactModeButton} ${searchMode === 'keyword' ? styles.active : ''}`}
              onClick={() => handleSearchModeChange('keyword')}
              title="키워드가 포함된 뉴스를 검색합니다"
            >
              <span className={styles.modeIcon}>🔍</span>
              <span className={styles.modeLabel}>일반</span>
            </button>
            <button
              type="button"
              className={`${styles.compactModeButton} ${searchMode === 'semantic' ? styles.active : ''}`}
              onClick={() => handleSearchModeChange('semantic')}
              title="의미가 유사한 뉴스를 AI로 검색합니다"
            >
              <span className={styles.modeIcon}>🤖</span>
              <span className={styles.modeLabel}>AI</span>
            </button>
          </div>

          <div className={styles.searchInputWrapper}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setShowHistory(true)}
              placeholder={searchMode === 'keyword' ? '키워드로 검색...' : 'AI 시맨틱 검색...'}
              className={styles.searchInput}
              disabled={loading}
            />
            {searchHistory.length > 0 && showHistory && (
              <div className={styles.searchHistoryDropdown}>
                <div className={styles.historyHeader}>
                  <span>최근 검색어</span>
                  <button
                    type="button"
                    onClick={clearSearchHistory}
                    className={styles.clearHistoryButton}
                  >
                    전체 삭제
                  </button>
                </div>
                <div className={styles.historyList}>
                  {searchHistory.map((item, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => {
                        setQuery(item);
                        setShowHistory(false);
                      }}
                      className={styles.historyItem}
                    >
                      <span className={styles.historyIcon}>🕐</span>
                      <span className={styles.historyText}>{item}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            type="submit"
            className={styles.searchButton}
            disabled={loading}
          >
            {loading ? '검색 중...' : '검색'}
          </button>

          {/* 시맨틱 검색 시 유사도 조절 */}
          {searchMode === 'semantic' && (
            <div
              className={styles.similarityCompact}
              title={
                minSimilarity >= 0.6
                  ? '엄격: 매우 관련성 높은 뉴스만'
                  : minSimilarity >= 0.4
                  ? '보통: 관련있는 뉴스 (권장)'
                  : minSimilarity >= 0.2
                  ? '느슨: 약간 관련있어도 포함'
                  : '전체: 모든 뉴스 (관련도순)'
              }
            >
              <label htmlFor="similarity-slider" className={styles.similarityLabel}>
                유사도
              </label>
              <input
                id="similarity-slider"
                type="range"
                min="0.0"
                max="0.9"
                step="0.05"
                value={minSimilarity}
                onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
                className={styles.similaritySliderCompact}
              />
              <span className={styles.similarityValue}>
                {(minSimilarity * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </form>

        {/* 검색 중 로딩 표시 */}
        {loading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSpinner}>
              <div className={styles.spinner}></div>
              <p className={styles.loadingText}>검색 중입니다...</p>
              <div className={styles.progressBar}>
                <div className={styles.progressFill}></div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className={styles.error}>
            {error}
          </div>
        )}

        {total > 0 && (
          <>
            {/* 날짜 필터 */}
            <div className={styles.dateFilter}>
              <label className={styles.filterLabel}>📅 기간 필터:</label>
              <div className={styles.dateFilterButtons}>
                <button
                  className={`${styles.dateFilterButton} ${dateFilter === 'all' ? styles.active : ''}`}
                  onClick={() => setDateFilter('all')}
                >
                  전체
                </button>
                <button
                  className={`${styles.dateFilterButton} ${dateFilter === 'today' ? styles.active : ''}`}
                  onClick={() => setDateFilter('today')}
                >
                  오늘
                </button>
                <button
                  className={`${styles.dateFilterButton} ${dateFilter === 'week' ? styles.active : ''}`}
                  onClick={() => setDateFilter('week')}
                >
                  최근 7일
                </button>
                <button
                  className={`${styles.dateFilterButton} ${dateFilter === 'month' ? styles.active : ''}`}
                  onClick={() => setDateFilter('month')}
                >
                  최근 30일
                </button>
                <button
                  className={`${styles.dateFilterButton} ${dateFilter === 'custom' ? styles.active : ''}`}
                  onClick={() => setDateFilter('custom')}
                >
                  직접 선택
                </button>
              </div>
              {dateFilter === 'custom' && (
                <div className={styles.customDateRange}>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className={styles.dateInput}
                  />
                  <span className={styles.dateSeparator}>~</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className={styles.dateInput}
                  />
                </div>
              )}
            </div>

            {/* 성능 정보 표시 - 현재 검색 모드와 마지막 검색 모드가 일치할 때만 표시 */}
            {searchTime > 0 && lastSearchMode === searchMode && (
              <div className={styles.performanceInfo}>
                <div className={styles.perfCard}>
                  <span className={styles.perfLabel}>⚡ 검색 시간</span>
                  <span className={styles.perfValue}>{searchTime.toFixed(2)}초</span>
                </div>
                <div className={styles.perfCard}>
                  <span className={styles.perfLabel}>📊 수집된 기사</span>
                  <span className={styles.perfValue}>{total}개</span>
                </div>
                {searchMode === 'semantic' && (
                  <div className={styles.perfCard}>
                    <span className={styles.perfLabel}>🎯 관련도 필터</span>
                    <span className={styles.perfValue}>{(minSimilarity * 100).toFixed(0)}%+</span>
                  </div>
                )}
                <div className={styles.perfCard}>
                  <span className={styles.perfLabel}>🔍 검색어</span>
                  <span className={styles.perfValue}>&quot;{lastSearchQuery}&quot;</span>
                </div>
              </div>
            )}

            <div className={styles.controls}>
              <div className={styles.resultCount}>
                총 {filteredAndSortedArticles.length}개의 기사
                {selectedSource && ` (${selectedSource})`}
                <span className={styles.pageInfo}>
                  {viewMode === 'list'
                    ? ` · ${displayedArticles.length}개 표시 중`
                    : ` · ${currentPage} / ${totalPages} 페이지`
                  }
                </span>
              </div>

              <div className={styles.controlButtons}>
                <button
                  className={`${styles.bookmarkFilterButton} ${showBookmarksOnly ? styles.active : ''}`}
                  onClick={() => setShowBookmarksOnly(!showBookmarksOnly)}
                  title={showBookmarksOnly ? '전체 보기' : '북마크만 보기'}
                >
                  {showBookmarksOnly ? '⭐ 북마크 필터 ON' : '☆ 북마크만 보기'}
                  {bookmarkedArticles.size > 0 && (
                    <span className={styles.bookmarkCount}>({bookmarkedArticles.size})</span>
                  )}
                </button>

                <div className={styles.itemsPerPageSelect}>
                  <select
                    value={itemsPerPage === filteredAndSortedArticles.length ? -1 : itemsPerPage}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setItemsPerPage(value === -1 ? filteredAndSortedArticles.length : value);
                    }}
                    className={styles.select}
                  >
                    <option value={10}>10개씩</option>
                    <option value={20}>20개씩</option>
                    <option value={30}>30개씩</option>
                    <option value={50}>50개씩</option>
                    <option value={100}>100개씩</option>
                    <option value={-1}>전체 ({filteredAndSortedArticles.length}개)</option>
                  </select>
                </div>

                <div className={styles.sortButtons}>
                  <button
                    className={`${styles.sortButton} ${sortOrder === 'desc' ? styles.active : ''}`}
                    onClick={() => setSortOrder('desc')}
                  >
                    {searchMode === 'semantic' ? '관련도 높은순' : '최신순'}
                  </button>
                  <button
                    className={`${styles.sortButton} ${sortOrder === 'asc' ? styles.active : ''}`}
                    onClick={() => setSortOrder('asc')}
                  >
                    {searchMode === 'semantic' ? '관련도 낮은순' : '오래된순'}
                  </button>
                </div>

                <div className={styles.viewButtons}>
                  <button
                    className={`${styles.viewButton} ${viewMode === 'list' ? styles.active : ''}`}
                    onClick={() => setViewMode('list')}
                    aria-label="리스트 보기"
                  >
                    ☰
                  </button>
                  <button
                    className={`${styles.viewButton} ${viewMode === 'grid' ? styles.active : ''}`}
                    onClick={() => setViewMode('grid')}
                    aria-label="그리드 보기"
                  >
                    ⊞
                  </button>
                </div>
              </div>
            </div>

            {sources.length > 1 && (
              <div className={styles.sourceFilterContainer}>
                <div className={styles.sourceFilterHeader}>
                  <span className={styles.sourceFilterTitle}>📰 언론사 필터</span>
                  <button
                    className={styles.sourceFilterToggle}
                    onClick={() => setShowSourceFilter(!showSourceFilter)}
                    aria-label={showSourceFilter ? '필터 접기' : '필터 펼치기'}
                  >
                    {showSourceFilter ? '▲ 접기' : '▼ 펼치기'}
                  </button>
                </div>
                {showSourceFilter && (
                  <div className={styles.sourceFilter}>
                    <button
                      className={`${styles.sourceButton} ${!selectedSource ? styles.active : ''}`}
                      onClick={() => setSelectedSource(null)}
                    >
                      전체 ({total})
                    </button>
                    {sources.map(({ source, count }) => (
                      <button
                        key={source}
                        className={`${styles.sourceButton} ${selectedSource === source ? styles.active : ''}`}
                        onClick={() => setSelectedSource(source)}
                      >
                        {source} ({count})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* 검색 결과 없음 메시지 */}
        {!loading && !error && articles.length === 0 && lastSearchQuery && (
          <div className={styles.noResults}>
            <div className={styles.noResultsIcon}>🔍</div>
            <h3 className={styles.noResultsTitle}>검색 결과가 없습니다</h3>
            <p className={styles.noResultsText}>
              &quot;{lastSearchQuery}&quot;에 대한 검색 결과를 찾을 수 없습니다.
            </p>
            <ul className={styles.noResultsTips}>
              <li>다른 키워드로 검색해보세요</li>
              <li>검색어의 철자를 확인해보세요</li>
              <li>더 일반적인 검색어를 사용해보세요</li>
            </ul>
          </div>
        )}

        {/* 모바일 탭 (시맨틱 검색 시) */}
        {searchMode === 'semantic' && total > 0 && (
          <div className={styles.mobileTabs}>
            <button
              className={`${styles.mobileTab} ${mobileTab === 'results' ? styles.active : ''}`}
              onClick={() => setMobileTab('results')}
            >
              검색 결과 ({filteredAndSortedArticles.length})
            </button>
            <button
              className={`${styles.mobileTab} ${mobileTab === 'analysis' ? styles.active : ''}`}
              onClick={() => setMobileTab('analysis')}
            >
              AI 분석
            </button>
          </div>
        )}

        {/* 2컬럼 레이아웃 (시맨틱 검색 시) */}
        <div className={`${searchMode === 'semantic' && total > 0 ? styles.twoColumnLayout : ''} ${mobileTab === 'analysis' ? styles.showAnalysis : ''}`}>
          {/* 검색 결과 영역 */}
          <div className={styles.resultsColumn}>
            <div className={`${styles.articles} ${styles[viewMode]}`}>
          {displayedArticles.map((article) => {
            const articleWithScore = article as NewsArticleWithScore;
            const hasSimilarityScore = 'similarity_score' in article && searchMode === 'semantic';

            const isBookmarked = bookmarkedArticles.has(article.id);

            return (
              <article key={article.id} className={styles.article}>
                <button
                  className={`${styles.bookmarkButton} ${isBookmarked ? styles.bookmarked : ''}`}
                  onClick={() => toggleBookmark(article.id)}
                  title={isBookmarked ? '북마크 해제' : '북마크 추가'}
                >
                  {isBookmarked ? '⭐' : '☆'}
                </button>
                {article.thumbnail && (
                  <img
                    src={article.thumbnail}
                    alt={article.title}
                    className={styles.thumbnail}
                  />
                )}
                <div className={styles.content}>
                  {/* 시맨틱 검색 시 유사도 점수 배지 */}
                  {hasSimilarityScore && (
                    <div className={styles.similarityBadge}>
                      <span
                        className={
                          articleWithScore.similarity_score >= 0.7
                            ? styles.scoreHigh
                            : articleWithScore.similarity_score >= 0.5
                            ? styles.scoreMedium
                            : styles.scoreLow
                        }
                      >
                        {(articleWithScore.similarity_score * 100).toFixed(0)}% 일치
                      </span>
                    </div>
                  )}
                  <h2 className={styles.title}>
                    <a href={article.url} target="_blank" rel="noopener noreferrer">
                      {highlightText(article.title, lastSearchQuery)}
                    </a>
                  </h2>
                  {article.snippet && (
                    <p className={styles.snippet}>
                      {highlightText(article.snippet, lastSearchQuery)}
                    </p>
                  )}
                  <div className={styles.meta}>
                    <span className={styles.source}>{article.source}</span>
                    <span className={styles.date}>{formatDate(article.publishedAt)}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* List view: infinite scroll loading/end messages */}
        {viewMode === 'list' && hasMore && (
          <div className={styles.loadingMore}>
            <div className={styles.loader}></div>
            <p>더 불러오는 중...</p>
          </div>
        )}

        {viewMode === 'list' && !hasMore && displayedArticles.length > 0 && (
          <div className={styles.endMessage}>
            모든 기사를 불러왔습니다 ({filteredAndSortedArticles.length}개)
          </div>
        )}

        {/* Grid view: pagination buttons */}
        {viewMode === 'grid' && totalPages > 1 && (
          <div className={styles.pagination}>
            <button
              className={styles.pageButton}
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              처음
            </button>
            <button
              className={styles.pageButton}
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              이전
            </button>

            {Array.from({ length: Math.min(10, totalPages) }, (_, i) => {
              const pageNum = Math.floor((currentPage - 1) / 10) * 10 + i + 1;
              if (pageNum > totalPages) return null;
              return (
                <button
                  key={pageNum}
                  className={`${styles.pageButton} ${currentPage === pageNum ? styles.active : ''}`}
                  onClick={() => setCurrentPage(pageNum)}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              className={styles.pageButton}
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              다음
            </button>
            <button
              className={styles.pageButton}
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              마지막
            </button>
          </div>
        )}
          </div>

          {/* AI 분석 패널 (시맨틱 검색 시) */}
          {searchMode === 'semantic' && total > 0 && (
            <div className={styles.analysisColumn}>
              <div className={styles.analysisPanel}>
                <div className={styles.analysisPanelHeader}>
                  <div className={styles.headerWithHelp}>
                    <h3>AI 뉴스 분석</h3>
                    <div className={styles.helpTooltip}>
                      <span className={styles.helpIcon}>?</span>
                      <div className={styles.tooltipContent}>
                        <p><strong>자동 분석:</strong> 시맨틱 검색 시 상위 100개 기사를 AI가 자동 분석합니다.</p>
                        <p><strong>분석 내용:</strong></p>
                        <ul>
                          <li>📋 핵심 요약</li>
                          <li>🎯 주요 포인트</li>
                          <li>💭 감성 분석 (긍정/부정)</li>
                          <li>📈 트렌드 및 키워드</li>
                        </ul>
                        <p><strong>소요 시간:</strong> 약 30초 ~ 1분</p>
                      </div>
                    </div>
                  </div>
                  <button
                    className={styles.toggleAnalysisButton}
                    onClick={() => setShowAnalysisPanel(!showAnalysisPanel)}
                    aria-label={showAnalysisPanel ? '패널 접기' : '패널 펼치기'}
                  >
                    {showAnalysisPanel ? '▼' : '▲'}
                  </button>
                </div>

                {showAnalysisPanel && (
                  <div className={styles.analysisPanelContent}>
                    {analysisLoading && (
                      <div className={styles.analysisLoading}>
                        <div className={styles.spinner}></div>
                        <p>AI가 뉴스를 분석하고 있습니다...</p>
                      </div>
                    )}

                    {analysisError && (
                      <div className={styles.analysisError}>
                        {analysisError}
                      </div>
                    )}

                    {analysisData && !analysisLoading && (
                      <>
                        {/* 요약 */}
                        <div className={styles.analysisSection}>
                          <h4>요약</h4>
                          <p className={styles.analysisSummary}>{analysisData.summary}</p>
                        </div>

                        {/* 주요 포인트 */}
                        {analysisData.key_points && analysisData.key_points.length > 0 && (
                          <div className={styles.analysisSection}>
                            <h4>주요 포인트</h4>
                            <ul className={styles.analysisKeyPoints}>
                              {analysisData.key_points.map((point, index) => (
                                <li key={index}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* 감정 분석 */}
                        {analysisData.sentiment && (
                          <div className={styles.analysisSection}>
                            <h4>감정 분석</h4>
                            <div className={styles.sentimentInfo}>
                              <div className={styles.sentimentOverall}>
                                <span className={styles.sentimentLabel}>전체 감정:</span>
                                <span className={styles.sentimentValue}>
                                  {analysisData.sentiment.overall_sentiment}
                                </span>
                              </div>
                              <div className={styles.sentimentScoreBar}>
                                <div className={styles.scoreBarContainer}>
                                  <div
                                    className={styles.scoreBarFill}
                                    style={{
                                      width: `${Math.abs(analysisData.sentiment.sentiment_score) * 50}%`,
                                      marginLeft: analysisData.sentiment.sentiment_score < 0
                                        ? `${50 - Math.abs(analysisData.sentiment.sentiment_score) * 50}%`
                                        : '50%',
                                      backgroundColor: analysisData.sentiment.sentiment_score > 0
                                        ? '#4caf50'
                                        : analysisData.sentiment.sentiment_score < 0
                                        ? '#f44336'
                                        : '#9e9e9e'
                                    }}
                                  ></div>
                                </div>
                                <div className={styles.scoreBarLabels}>
                                  <span>부정</span>
                                  <span>중립</span>
                                  <span>긍정</span>
                                </div>
                              </div>

                              {analysisData.sentiment.positive_aspects && analysisData.sentiment.positive_aspects.length > 0 && (
                                <div className={styles.sentimentAspects}>
                                  <strong>✅ 긍정적 측면:</strong>
                                  <ul>
                                    {analysisData.sentiment.positive_aspects.map((aspect, idx) => (
                                      <li key={idx}>{aspect}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {analysisData.sentiment.negative_aspects && analysisData.sentiment.negative_aspects.length > 0 && (
                                <div className={styles.sentimentAspects}>
                                  <strong>⚠️ 부정적 측면:</strong>
                                  <ul>
                                    {analysisData.sentiment.negative_aspects.map((aspect, idx) => (
                                      <li key={idx}>{aspect}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 트렌드 분석 */}
                        {analysisData.trends && (
                          <div className={styles.analysisSection}>
                            <h4>트렌드</h4>
                            <div className={styles.trendsInfo}>
                              {analysisData.trends.main_topics.length > 0 && (
                                <div className={styles.trendItem}>
                                  <strong>주요 주제:</strong>
                                  <div className={styles.trendTags}>
                                    {analysisData.trends.main_topics.map((topic, idx) => (
                                      <span key={idx} className={styles.trendTag}>{topic}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {analysisData.trends.emerging_trends.length > 0 && (
                                <div className={styles.trendItem}>
                                  <strong>떠오르는 트렌드:</strong>
                                  <div className={styles.trendTags}>
                                    {analysisData.trends.emerging_trends.map((trend, idx) => (
                                      <span key={idx} className={styles.trendTag}>{trend}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {analysisData.trends.key_entities.length > 0 && (
                                <div className={styles.trendItem}>
                                  <strong>주요 키워드:</strong>
                                  <div className={styles.trendTags}>
                                    {analysisData.trends.key_entities.map((entity, idx) => (
                                      <span key={idx} className={styles.trendTag}>{entity}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 분석 메타 정보 */}
                        <div className={styles.analysisMeta}>
                          <small>
                            {analysisData.articles_analyzed}개 기사 분석 완료 ·{' '}
                            {new Date(analysisData.generated_at).toLocaleString('ko-KR')}
                          </small>
                        </div>
                      </>
                    )}

                    {!analysisData && !analysisLoading && !analysisError && lastSearchQuery && articles.length > 0 && (
                      <div className={styles.analysisPlaceholder}>
                        <p>검색 결과가 준비되었습니다.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 설정 모달 */}
      {showSettings && (
        <div className={styles.modalOverlay} onClick={() => setShowSettings(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>⚙️ 설정</h2>
              <button
                className={styles.modalCloseButton}
                onClick={() => setShowSettings(false)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* 탭 네비게이션 */}
              <div className={styles.settingsTabs}>
                <button
                  className={`${styles.settingsTab} ${settingsTab === 'auto' ? styles.activeTab : ''}`}
                  onClick={() => setSettingsTab('auto')}
                >
                  🔄 자동 검색
                </button>
                <button
                  className={`${styles.settingsTab} ${settingsTab === 'filter' ? styles.activeTab : ''}`}
                  onClick={() => setSettingsTab('filter')}
                >
                  📰 언론사 필터
                </button>
              </div>

              {/* 자동 검색 탭 */}
              {settingsTab === 'auto' && (
              <div className={styles.settingSection}>
                <h3 className={styles.sectionTitle}>자동 검색</h3>

                <div className={styles.settingItem}>
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={autoSearchEnabled}
                      onChange={(e) => setAutoSearchEnabled(e.target.checked)}
                      className={styles.toggleCheckbox}
                    />
                    <span className={styles.toggleText}>
                      페이지 로드 시 자동으로 검색 실행
                    </span>
                  </label>
                </div>

                <div className={styles.settingItem}>
                  <label htmlFor="default-query" className={styles.settingLabel}>
                    기본 검색어
                  </label>
                  <input
                    id="default-query"
                    type="text"
                    value={defaultQuery}
                    onChange={(e) => setDefaultQuery(e.target.value)}
                    placeholder="예: 최신 뉴스, 기술 뉴스"
                    className={styles.settingInput}
                  />
                </div>

                <div className={styles.settingItem}>
                  <label className={styles.settingLabel}>검색 모드</label>
                  <div className={styles.searchModeOptions}>
                    <label className={styles.radioLabel}>
                      <input
                        type="radio"
                        name="defaultSearchMode"
                        value="keyword"
                        checked={defaultSearchMode === 'keyword'}
                        onChange={() => setDefaultSearchMode('keyword')}
                        className={styles.radioInput}
                      />
                      <span>일반 검색</span>
                    </label>
                    <label className={styles.radioLabel}>
                      <input
                        type="radio"
                        name="defaultSearchMode"
                        value="semantic"
                        checked={defaultSearchMode === 'semantic'}
                        onChange={() => setDefaultSearchMode('semantic')}
                        className={styles.radioInput}
                      />
                      <span>시맨틱 검색</span>
                    </label>
                  </div>
                </div>

                {defaultSearchMode === 'semantic' && (
                  <div className={styles.settingItem}>
                    <label htmlFor="default-similarity" className={styles.settingLabel}>
                      최소 유사도: <strong>{(defaultMinSimilarity * 100).toFixed(0)}%</strong>
                    </label>
                    <input
                      id="default-similarity"
                      type="range"
                      min="0.0"
                      max="0.9"
                      step="0.05"
                      value={defaultMinSimilarity}
                      onChange={(e) => setDefaultMinSimilarity(parseFloat(e.target.value))}
                      className={styles.similaritySlider}
                    />
                    <div className={styles.similarityHint}>
                      {defaultMinSimilarity >= 0.6
                        ? '엄격: 매우 관련성 높은 뉴스만 표시'
                        : defaultMinSimilarity >= 0.4
                        ? '보통: 관련있는 뉴스 표시 (권장)'
                        : defaultMinSimilarity >= 0.2
                        ? '느슨: 약간 관련있어도 포함'
                        : '전체: 모든 뉴스 표시 (관련도순 정렬)'}
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* 언론사 필터 탭 */}
              {settingsTab === 'filter' && (
              <div className={styles.settingSection}>
                <h3 className={styles.sectionTitle}>언론사 필터</h3>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  제외할 언론사를 선택하세요. 선택된 언론사의 기사는 검색 결과에서 제외됩니다.
                </p>

                {/* 카테고리별로 언론사 표시 */}
                {['검색엔진', '한국', '미국', '영국', '통신사', '경제', '기타'].map(category => {
                  const sourcesInCategory = NEWS_SOURCES.filter(s => s.category === category);
                  if (sourcesInCategory.length === 0) return null;

                  // 해당 카테고리의 모든 소스가 제외되었는지 확인
                  const allExcluded = sourcesInCategory.every(s => excludedSources.has(s.id));
                  const someExcluded = sourcesInCategory.some(s => excludedSources.has(s.id));

                  const toggleCategoryExclusion = () => {
                    const newExcluded = new Set(excludedSources);
                    if (allExcluded) {
                      // 전체 포함 (모두 제거)
                      sourcesInCategory.forEach(s => newExcluded.delete(s.id));
                    } else {
                      // 전체 제외 (모두 추가)
                      sourcesInCategory.forEach(s => newExcluded.add(s.id));
                    }
                    setExcludedSources(newExcluded);
                  };

                  return (
                    <div key={category} style={{ marginBottom: '20px' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginBottom: '10px'
                      }}>
                        <h4 style={{
                          fontSize: '13px',
                          fontWeight: '700',
                          color: 'var(--accent-color)',
                          margin: 0,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          {category} ({sourcesInCategory.length}개)
                        </h4>
                        <button
                          onClick={toggleCategoryExclusion}
                          style={{
                            padding: '6px 12px',
                            fontSize: '11px',
                            fontWeight: '600',
                            background: allExcluded
                              ? 'var(--accent-color)'
                              : someExcluded
                              ? 'var(--bg-secondary)'
                              : 'var(--error-bg)',
                            color: allExcluded
                              ? 'white'
                              : someExcluded
                              ? 'var(--text-primary)'
                              : 'var(--error-text)',
                            border: '2px solid',
                            borderColor: allExcluded
                              ? 'var(--accent-color)'
                              : someExcluded
                              ? 'var(--border-color)'
                              : 'var(--error-border)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}
                        >
                          {allExcluded ? '✓ 전체 포함' : '✕ 전체 제외'}
                        </button>
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                        gap: '8px'
                      }}>
                        {sourcesInCategory.map(source => (
                          <label
                            key={source.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '8px 12px',
                              background: excludedSources.has(source.id)
                                ? 'var(--error-bg)'
                                : 'var(--bg-hover)',
                              borderRadius: '8px',
                              border: '2px solid',
                              borderColor: excludedSources.has(source.id)
                                ? 'var(--error-border)'
                                : 'var(--border-color)',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              fontSize: '13px'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={excludedSources.has(source.id)}
                              onChange={(e) => {
                                const newExcluded = new Set(excludedSources);
                                if (e.target.checked) {
                                  newExcluded.add(source.id);
                                } else {
                                  newExcluded.delete(source.id);
                                }
                                setExcludedSources(newExcluded);
                              }}
                              style={{ cursor: 'pointer' }}
                            />
                            <span style={{
                              color: excludedSources.has(source.id)
                                ? 'var(--error-text)'
                                : 'var(--text-primary)',
                              fontWeight: excludedSources.has(source.id) ? '600' : '500'
                            }}>
                              {source.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: 'var(--bg-hover)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '14px'
                  }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      제외된 언론사: <strong style={{ color: 'var(--error-text)' }}>{excludedSources.size}개</strong>
                    </span>
                    {excludedSources.size > 0 && (
                      <button
                        onClick={() => setExcludedSources(new Set())}
                        style={{
                          padding: '6px 12px',
                          fontSize: '12px',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          color: 'var(--text-primary)'
                        }}
                      >
                        모두 해제
                      </button>
                    )}
                  </div>
                </div>
              </div>
              )}

              {/* 나중에 다른 섹션 추가 가능 */}
            </div>

            <div className={styles.modalFooter}>
              <button
                className={styles.cancelButton}
                onClick={() => setShowSettings(false)}
              >
                취소
              </button>
              <button
                className={styles.saveButton}
                onClick={saveAutoSearchSettings}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
