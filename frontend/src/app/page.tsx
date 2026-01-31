'use client';

import { useState, useEffect, useMemo } from 'react';
import { NewsApiService } from '@/services/newsApi';
import type { NewsArticle, NewsArticleWithScore, SearchMode } from '@/types/news';
import styles from './page.module.css';

type ViewMode = 'list' | 'grid';
type SortOrder = 'desc' | 'asc';
type Theme = 'light' | 'dark';

export default function Home() {
  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState<NewsArticle[] | NewsArticleWithScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  // 검색 모드 상태 추가
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword');
  const [minSimilarity, setMinSimilarity] = useState<number>(0.0);  // 기본값 0 (모든 결과 표시)

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
  }, []);

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

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!query.trim()) {
      setError('검색어를 입력해주세요');
      return;
    }

    setLoading(true);
    setError('');
    setSelectedSource(null);
    setCurrentPage(1);
    setDisplayedCount(itemsPerPage);
    setLastSearchQuery(query);
    setShowHistory(false);

    // 검색 히스토리에 추가
    addToSearchHistory(query);

    const startTime = performance.now();

    try {
      if (searchMode === 'semantic') {
        // 시맨틱 검색
        const response = await NewsApiService.semanticSearchNews({
          q: query,
          hl: 'ko',
          gl: 'kr',
          num: 500,
          min_similarity: minSimilarity,
        });

        setArticles(response.articles);
        setTotal(response.total);
      } else {
        // 키워드 검색
        const response = await NewsApiService.searchNews({
          q: query,
          hl: 'ko',
          gl: 'kr',
          num: 500,
        });

        setArticles(response.articles);
        setTotal(response.total);
      }

      const endTime = performance.now();
      setSearchTime((endTime - startTime) / 1000); // Convert to seconds
    } catch (err) {
      setError(err instanceof Error ? err.message : '뉴스를 불러오는데 실패했습니다');
      setArticles([]);
      setTotal(0);
      setSearchTime(0);
    } finally {
      setLoading(false);
    }
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
      {/* 우측 상단 고정 테마 토글 버튼 */}
      <button
        className={styles.themeToggle}
        onClick={toggleTheme}
        aria-label="테마 전환"
        title={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
      >
        {theme === 'light' ? '🌙' : '☀️'}
      </button>

      <header className={styles.header}>
        <h1>뉴스 검색</h1>
        <p>구글 뉴스에서 기사를 검색해보세요</p>
      </header>

      <main className={styles.main}>
        {/* 검색 모드 선택 */}
        <div className={styles.searchModeSelector}>
          <div className={styles.modeButtons}>
            <button
              type="button"
              className={`${styles.modeButton} ${searchMode === 'keyword' ? styles.active : ''}`}
              onClick={() => setSearchMode('keyword')}
            >
              일반 검색
            </button>
            <button
              type="button"
              className={`${styles.modeButton} ${searchMode === 'semantic' ? styles.active : ''}`}
              onClick={() => setSearchMode('semantic')}
            >
              시맨틱 검색
            </button>
          </div>
          <div className={styles.modeDescription}>
            {searchMode === 'keyword'
              ? '키워드가 포함된 뉴스를 검색합니다 (날짜순 정렬)'
              : '의미가 유사한 뉴스를 AI로 검색합니다 (관련도순 정렬)'}
          </div>
        </div>

        {/* 시맨틱 검색 시 유사도 설정 */}
        {searchMode === 'semantic' && (
          <div className={styles.similarityControl}>
            <label htmlFor="similarity-slider">
              최소 유사도: <strong>{(minSimilarity * 100).toFixed(0)}%</strong>
            </label>
            <input
              id="similarity-slider"
              type="range"
              min="0.0"
              max="0.9"
              step="0.1"
              value={minSimilarity}
              onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
              className={styles.similaritySlider}
            />
            <div className={styles.similarityHint}>
              {minSimilarity >= 0.6
                ? '엄격 (매우 관련성 높은 뉴스만)'
                : minSimilarity >= 0.3
                ? '보통 (적당히 관련있는 뉴스)'
                : minSimilarity > 0
                ? '느슨 (약간 관련있어도 포함)'
                : '전체 (모든 뉴스 표시, 관련도순 정렬)'}
            </div>
          </div>
        )}

        <form onSubmit={handleSearch} className={styles.searchForm}>
          <div className={styles.searchInputWrapper}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setShowHistory(true)}
              placeholder="검색어를 입력하세요..."
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
        </form>

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

            {/* 성능 정보 표시 */}
            {searchTime > 0 && (
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
          </>
        )}

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
      </main>
    </div>
  );
}
