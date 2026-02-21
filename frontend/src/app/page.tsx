'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { NewsApiService } from '@/services/newsApi';
import type { NewsArticle, NewsArticleWithScore, SearchMode, NewsAnalysisResponse, SentimentType, LarkConfig } from '@/types/news';
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
  { id: 'daum', name: 'Daum 뉴스', category: '검색엔진' },
  { id: '연합뉴스', name: '연합뉴스', category: '한국' },
  { id: 'KBS', name: 'KBS', category: '한국' },
  { id: 'KBS 경제', name: 'KBS 경제', category: '한국' },
  { id: 'KBS 사회', name: 'KBS 사회', category: '한국' },
  { id: 'KBS 국제', name: 'KBS 국제', category: '한국' },
  { id: 'MBC', name: 'MBC', category: '한국' },
  { id: 'SBS', name: 'SBS', category: '한국' },
  { id: 'SBS 경제', name: 'SBS 경제', category: '한국' },
  { id: 'SBS IT/과학', name: 'SBS IT/과학', category: '한국' },
  { id: 'JTBC', name: 'JTBC', category: '한국' },
  { id: '한겨레', name: '한겨레', category: '한국' },
  { id: '경향신문', name: '경향신문', category: '한국' },
  { id: '조선일보', name: '조선일보', category: '한국' },
  { id: '중앙일보', name: '중앙일보', category: '한국' },
  { id: '동아일보', name: '동아일보', category: '한국' },
  { id: '매일경제', name: '매일경제', category: '한국' },
  { id: '한국경제', name: '한국경제', category: '한국' },
  { id: 'YTN', name: 'YTN', category: '한국' },
  { id: 'MBN', name: 'MBN', category: '한국' },
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

// 자연어 → cron 표현식 파서
const parseNaturalSchedule = (text: string): { cron: string; description: string } | null => {
  const t = text.trim();
  if (!t) return null;

  // 이미 cron 표현식인 경우 (5개 토큰, 각 토큰이 cron 문자로만 구성)
  const cronParts = t.split(/\s+/);
  if (cronParts.length === 5 && cronParts.every(p => /^[\d\*\/,\-]+$/.test(p))) {
    return { cron: t, description: cronToNatural(t) };
  }

  // 시간 파싱 헬퍼
  const parseTime = (str: string): { hour: number; minute: number } | null => {
    const match = str.match(/(오전|오후)?\s*(\d{1,2})시\s*(\d{1,2})?\s*분?/);
    if (!match) return null;
    let hour = parseInt(match[2]);
    const minute = match[3] ? parseInt(match[3]) : 0;
    if (match[1] === '오후' && hour < 12) hour += 12;
    if (match[1] === '오전' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  };

  // N분마다
  const minMatch = t.match(/(\d+)\s*분\s*마다/);
  if (minMatch) {
    const n = parseInt(minMatch[1]);
    if (n >= 1 && n <= 59) return { cron: `*/${n} * * * *`, description: `${n}분마다 실행` };
  }

  // N시간마다
  const hourMatch = t.match(/(\d+)\s*시간\s*마다/);
  if (hourMatch) {
    const n = parseInt(hourMatch[1]);
    if (n >= 1 && n <= 23) return { cron: `0 */${n} * * *`, description: `${n}시간마다 실행` };
  }

  // 요일 매핑
  const dayMap: Record<string, string> = {
    '일요일': '0', '월요일': '1', '화요일': '2', '수요일': '3',
    '목요일': '4', '금요일': '5', '토요일': '6',
    '일': '0', '월': '1', '화': '2', '수': '3',
    '목': '4', '금': '5', '토': '6',
  };

  // 매주 [요일] [시간]
  const weeklyMatch = t.match(/매주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)\s*(.*)/);
  if (weeklyMatch) {
    const dow = dayMap[weeklyMatch[1]];
    const time = parseTime(weeklyMatch[2]);
    if (time && dow !== undefined) {
      return { cron: `${time.minute} ${time.hour} * * ${dow}`, description: `매주 ${weeklyMatch[1]} ${time.hour}시${time.minute ? ` ${time.minute}분` : ''} 실행` };
    }
  }

  // 평일 [시간]
  const weekdayMatch = t.match(/평일\s*(.*)/);
  if (weekdayMatch) {
    const time = parseTime(weekdayMatch[1]);
    if (time) {
      return { cron: `${time.minute} ${time.hour} * * 1-5`, description: `평일 ${time.hour}시${time.minute ? ` ${time.minute}분` : ''} 실행` };
    }
  }

  // 주말 [시간]
  const weekendMatch = t.match(/주말\s*(.*)/);
  if (weekendMatch) {
    const time = parseTime(weekendMatch[1]);
    if (time) {
      return { cron: `${time.minute} ${time.hour} * * 0,6`, description: `주말 ${time.hour}시${time.minute ? ` ${time.minute}분` : ''} 실행` };
    }
  }

  // 매일 [시간], [시간] (복수 시간)
  const dailyMultiMatch = t.match(/매일\s*(.*)/);
  if (dailyMultiMatch) {
    const timeParts = dailyMultiMatch[1].split(/[,과]\s*/);
    if (timeParts.length > 1) {
      const times = timeParts.map(tp => parseTime(tp.trim())).filter(Boolean) as { hour: number; minute: number }[];
      if (times.length > 1 && times.every(tt => tt.minute === 0)) {
        const hours = times.map(tt => tt.hour).join(',');
        const formatH = (h: number) => h < 12 ? `오전 ${h || 12}시` : `오후 ${h === 12 ? 12 : h - 12}시`;
        return { cron: `0 ${hours} * * *`, description: `매일 ${times.map(tt => formatH(tt.hour)).join(', ')} 실행` };
      }
    }
    const time = parseTime(dailyMultiMatch[1]);
    if (time) {
      return { cron: `${time.minute} ${time.hour} * * *`, description: `매일 ${time.hour}시${time.minute ? ` ${time.minute}분` : ''} 실행` };
    }
  }

  // 단독 시간 표현 (매일로 간주)
  const soloTime = parseTime(t);
  if (soloTime) {
    return { cron: `${soloTime.minute} ${soloTime.hour} * * *`, description: `매일 ${soloTime.hour}시${soloTime.minute ? ` ${soloTime.minute}분` : ''} 실행` };
  }

  return null;
};

// cron → 자연어 변환
const cronToNatural = (cron: string): string => {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;

  // N분마다
  if (min.startsWith('*/') && hour === '*' && dow === '*') {
    return `${min.slice(2)}분마다`;
  }

  // N시간마다
  if (min === '0' && hour.startsWith('*/') && dow === '*') {
    return `${hour.slice(2)}시간마다`;
  }

  const formatHour = (h: number) => {
    if (h === 0) return '오전 12시';
    if (h < 12) return `오전 ${h}시`;
    if (h === 12) return '오후 12시';
    return `오후 ${h - 12}시`;
  };

  // 복수 시간
  if (hour.includes(',') && dow === '*') {
    const hours = hour.split(',').map(h => formatHour(parseInt(h)));
    const minute = parseInt(min);
    const minStr = minute > 0 ? ` ${minute}분` : '';
    return `매일 ${hours.map(h => h + minStr).join(', ')}`;
  }

  const h = parseInt(hour);
  const m = parseInt(min);
  if (isNaN(h)) return cron;
  const timeStr = formatHour(h) + (m > 0 ? ` ${m}분` : '');

  if (dow === '*') return `매일 ${timeStr}`;
  if (dow === '1-5') return `평일 ${timeStr}`;
  if (dow === '0,6') return `주말 ${timeStr}`;

  const dayNames: Record<string, string> = {
    '0': '일요일', '1': '월요일', '2': '화요일', '3': '수요일',
    '4': '목요일', '5': '금요일', '6': '토요일',
  };
  if (dayNames[dow]) return `매주 ${dayNames[dow]} ${timeStr}`;

  return cron;
};

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
  const [settingsTab, setSettingsTab] = useState<'auto-search' | 'lark' | 'keywords'>('auto-search');
  const [defaultQuery, setDefaultQuery] = useState<string>('');
  const [defaultSearchMode, setDefaultSearchMode] = useState<SearchMode>('keyword');
  const [defaultMinSimilarity, setDefaultMinSimilarity] = useState<number>(0.3);
  const [autoSearchEnabled, setAutoSearchEnabled] = useState<boolean>(false);
  const [excludedSources, setExcludedSources] = useState<Set<string>>(new Set());
  const [maxArticles, setMaxArticles] = useState<number>(200); // 크롤링할 최대 기사 수

  // 언론사 필터 펼침/접힘
  const [showSourceFilter, setShowSourceFilter] = useState<boolean>(true);

  // AI 분석 상태
  const [analysisData, setAnalysisData] = useState<NewsAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string>('');
  const [showAnalysisPanel, setShowAnalysisPanel] = useState<boolean>(true);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const analysisInProgress = useRef(false);
  // 분류 완료된 전체 기사 (감성 필터 변경 시 재분류 없이 재분석용)
  const classifiedArticlesRef = useRef<any[]>([]);

  // 감성 필터 상태 (AI 검색용)
  const [sentimentFilter, setSentimentFilter] = useState<Set<SentimentType>>(
    new Set(['positive', 'negative', 'neutral'])
  );

  // 모바일 탭 상태 (검색 결과 / 분석 결과)
  const [mobileTab, setMobileTab] = useState<'results' | 'analysis'>('results');

  // Lark 설정 상태
  const [larkEnabled, setLarkEnabled] = useState(false);
  const [larkWebhookUrl, setLarkWebhookUrl] = useState('');
  const [larkScheduleText, setLarkScheduleText] = useState('매일 오전 9시');
  const [larkSentimentTypes, setLarkSentimentTypes] = useState<Set<SentimentType>>(
    new Set(['negative'])
  );
  const [larkQuery, setLarkQuery] = useState('');
  const [larkTestLoading, setLarkTestLoading] = useState(false);
  const [larkTestMessage, setLarkTestMessage] = useState('');

  // 감성 키워드 설정 상태
  const [customPositiveKeywords, setCustomPositiveKeywords] = useState<string[]>([]);
  const [customNegativeKeywords, setCustomNegativeKeywords] = useState<string[]>([]);
  const [defaultPositiveKeywords, setDefaultPositiveKeywords] = useState<string[]>([]);
  const [defaultNegativeKeywords, setDefaultNegativeKeywords] = useState<string[]>([]);
  const [newPositiveKeyword, setNewPositiveKeyword] = useState('');
  const [newNegativeKeyword, setNewNegativeKeyword] = useState('');

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
        setMaxArticles(parsed.maxArticles || 200);

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

    // Lark 설정 로드
    const loadLarkConfig = async () => {
      try {
        const config = await NewsApiService.getLarkSchedule();
        if (config) {
          setLarkEnabled(config.enabled);
          setLarkWebhookUrl(config.webhookUrl);
          setLarkScheduleText(cronToNatural(config.schedule));
          setLarkQuery(config.query);
          setLarkSentimentTypes(new Set(config.sentimentTypes));
        }
      } catch (error) {
        console.error('Failed to load Lark config:', error);
      }
    };

    loadLarkConfig();

    // 감성 키워드 로드
    const loadKeywords = async () => {
      try {
        const data = await NewsApiService.getKeywordSettings();
        setCustomPositiveKeywords(data.positive);
        setCustomNegativeKeywords(data.negative);
        setDefaultPositiveKeywords(data.defaults.positive);
        setDefaultNegativeKeywords(data.defaults.negative);
      } catch (error) {
        console.error('Failed to load keyword settings:', error);
      }
    };

    loadKeywords();
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

  // Lark 테스트 전송
  const handleSendTestLark = async () => {
    if (!larkWebhookUrl || !larkQuery) {
      setLarkTestMessage('Webhook URL과 검색어를 입력해주세요');
      return;
    }

    setLarkTestLoading(true);
    setLarkTestMessage('');

    try {
      const result = await NewsApiService.sendLarkManual({
        webhookUrl: larkWebhookUrl,
        query: larkQuery,
        sentimentTypes: Array.from(larkSentimentTypes),
        num: maxArticles,
        excluded_sources: Array.from(excludedSources)
      });

      setLarkTestMessage(`✅ 전송 성공! ${result.articlesSent}개 기사 전송됨`);
      setTimeout(() => setLarkTestMessage(''), 5000);
    } catch (error) {
      setLarkTestMessage(`❌ 전송 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLarkTestLoading(false);
    }
  };

  // Lark 설정 저장
  const saveLarkConfig = async () => {
    try {
      const config: LarkConfig = {
        enabled: larkEnabled,
        schedule: parseNaturalSchedule(larkScheduleText)?.cron || '0 9 * * *',
        webhookUrl: larkWebhookUrl,
        query: larkQuery,
        sentimentTypes: Array.from(larkSentimentTypes),
        num: maxArticles,
        excluded_sources: Array.from(excludedSources)
      };

      await NewsApiService.saveLarkSchedule(config);
    } catch (error) {
      console.error('Failed to save Lark config:', error);
      throw error;
    }
  };

  const saveAutoSearchSettings = async () => {
    const settings = {
      enabled: autoSearchEnabled,
      query: defaultQuery,
      searchMode: defaultSearchMode,
      minSimilarity: defaultMinSimilarity,
      maxArticles: maxArticles,
    };
    localStorage.setItem('autoSearchSettings', JSON.stringify(settings));

    // 제외할 언론사 저장
    localStorage.setItem('excludedSources', JSON.stringify(Array.from(excludedSources)));

    // Lark 설정도 함께 저장
    if (settingsTab === 'lark') {
      try {
        await saveLarkConfig();
      } catch (error) {
        alert('Lark 설정 저장 실패: ' + (error instanceof Error ? error.message : '알 수 없는 오류'));
        return;
      }
    }

    // 키워드 설정 저장
    if (settingsTab === 'keywords') {
      try {
        await NewsApiService.saveKeywordSettings({
          positive: customPositiveKeywords,
          negative: customNegativeKeywords,
        });
      } catch (error) {
        alert('키워드 설정 저장 실패: ' + (error instanceof Error ? error.message : '알 수 없는 오류'));
        return;
      }
    }

    setShowSettings(false);
  };

  // 기사 감성 분류 함수
  const classifyArticlesBySentiment = (articles: NewsArticleWithScore[], sentiment: any, searchQuery: string) => {
    if (!sentiment || !articles || articles.length === 0) {
      return articles.map(a => ({ ...a, sentiment: 'neutral' as SentimentType }));
    }

    // 검색 키워드 정규화
    const queryKeywords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length >= 2);

    // 커스텀 감성 키워드 사용 (state에서 로드)
    const forceNegativeKeywords = customNegativeKeywords;
    const forcePositiveKeywords = customPositiveKeywords;

    const extractKeywords = (text: string): string[] => {
      if (!text) return [];
      return text.split(/\s+/).filter(w => w.length >= 2);
    };

    const positiveKeywords = extractKeywords(
      (sentiment.positive_aspects || []).join(' ')
    );
    const negativeKeywords = extractKeywords(
      (sentiment.negative_aspects || []).join(' ')
    );

    return articles.map(article => {
      const title = (article.title || '').toLowerCase();
      const snippet = (article.snippet || '').toLowerCase();

      // 0단계: 검색 키워드가 제목에 포함되어 있는지 확인 (제목 중심 분류)
      const titleHasQuery = queryKeywords.some(qk => title.includes(qk));

      // 제목에 검색 키워드가 없으면 중립으로 처리
      if (!titleHasQuery) {
        return { ...article, sentiment: 'neutral' as SentimentType };
      }

      // 1단계: 강제 키워드 체크 (제목에만 적용)
      for (const keyword of forceNegativeKeywords) {
        if (title.includes(keyword)) {
          return { ...article, sentiment: 'negative' as SentimentType };
        }
      }
      for (const keyword of forcePositiveKeywords) {
        if (title.includes(keyword)) {
          return { ...article, sentiment: 'positive' as SentimentType };
        }
      }

      // 2단계: LLM 키워드 기반 분류 (제목에서만 매칭)
      let positiveScore = 0;
      let negativeScore = 0;

      // 제목에서만 키워드 매칭
      positiveKeywords.forEach(k => {
        if (title.includes(k.toLowerCase())) {
          positiveScore += 1;
        }
      });
      negativeKeywords.forEach(k => {
        if (title.includes(k.toLowerCase())) {
          negativeScore += 1;
        }
      });

      // 임계값: 제목에 최소 1개 키워드 이상, 명확한 차이가 있을 때만 분류
      const threshold = 1;
      const minDifference = 1;

      let articleSentiment: SentimentType = 'neutral';

      if (positiveScore >= threshold && positiveScore > negativeScore && positiveScore - negativeScore >= minDifference) {
        articleSentiment = 'positive';
      } else if (negativeScore >= threshold && negativeScore > positiveScore && negativeScore - positiveScore >= minDifference) {
        articleSentiment = 'negative';
      }

      return { ...article, sentiment: articleSentiment };
    });
  };

  const performAnalysis = async (searchQuery: string, inputArticles?: any[]) => {
    // 중복 호출 방지
    if (analysisInProgress.current) {
      console.log('[AI] Analysis already in progress, skipping');
      return;
    }
    analysisInProgress.current = true;

    setAnalysisLoading(true);
    setAnalysisError('');
    setProgressPercent(5);
    setAnalysisStep('감성 분류 준비 중...');

    // state 대신 직접 전달받은 articles 사용 (React state 비동기 문제 방지)
    const targetArticles = inputArticles || articles;

    try {
      // 1단계: 먼저 모든 기사에 대해 LLM 기반 감성 분류 수행
      let classifiedArticles = targetArticles;
      let filteredArticlesForAnalysis = targetArticles;

      if (targetArticles.length > 0) {
        try {
          setProgressPercent(10);
          setAnalysisStep(`감성 분류 중... (${targetArticles.length}개 기사)`);

          const classificationResult = await NewsApiService.classifySentiment(
            targetArticles,
            searchQuery,
            ['positive', 'negative', 'neutral']
          );

          classifiedArticles = classificationResult.articles;
          classifiedArticlesRef.current = classifiedArticles;
          setProgressPercent(60);

          filteredArticlesForAnalysis = classifiedArticles.filter((article: any) =>
            sentimentFilter.has(article.sentiment)
          );

        } catch (classifyError) {
          console.error('[AI] LLM sentiment classification failed:', classifyError);
          filteredArticlesForAnalysis = targetArticles;
          setProgressPercent(60);
        }
      }

      // 2단계: 필터링된 기사만 LLM으로 분석
      setProgressPercent(65);
      setAnalysisStep(`AI 분석 중... (${filteredArticlesForAnalysis.length}개 기사)`);

      const response = await NewsApiService.analyzeNews({
        q: searchQuery,
        hl: 'ko',
        gl: 'kr',
        num: 100,
        analysis_type: 'comprehensive',
        days_back: 30,
        excluded_sources: Array.from(excludedSources),
        articles: filteredArticlesForAnalysis,
      });

      setProgressPercent(100);
      setAnalysisData(response);
      setShowAnalysisPanel(true);
      setArticles(classifiedArticles);

      setSemanticSearchCache(prev => {
        if (prev && prev.query === searchQuery) {
          return { ...prev, analysisData: response };
        }
        return prev;
      });
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : '뉴스 분석에 실패했습니다');
      setAnalysisData(null);
    } finally {
      setAnalysisLoading(false);
      setAnalysisStep('');
      setProgressPercent(0);
      analysisInProgress.current = false;
    }
  };

  // 감성 필터 변경 핸들러 (클라이언트 사이드 필터링만, API 재호출 없음)
  const handleSentimentFilterChange = (type: SentimentType, checked: boolean) => {
    const newFilter = new Set(sentimentFilter);
    if (checked) {
      newFilter.add(type);
    } else {
      newFilter.delete(type);
    }
    setSentimentFilter(newFilter);
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
          num: maxArticles,
          min_similarity: minSimilarity,
          excluded_sources: Array.from(excludedSources),
        });

        responseArticles = response.articles;
        responseTotal = response.total;
        setArticles(response.articles);
        setTotal(response.total);
      } else {
        // 키워드 검색
        const response = await NewsApiService.searchNews({
          q: searchQuery,
          hl: 'ko',
          gl: 'kr',
          num: maxArticles,
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

      // 시맨틱 검색일 때만 AI 분석 + 감성 분류 자동 실행
      if (mode === 'semantic' && responseArticles.length > 0) {
        console.log(`[Search] semantic search completed, automatically running analysis...`);
        performAnalysis(searchQuery, responseArticles);
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

    // 감성 필터링 (기사에 sentiment 필드가 있을 때)
    if (sentimentFilter.size < 3) {
      result = result.filter(article => {
        const articleWithSentiment = article as any;
        if (!articleWithSentiment.sentiment) return true; // 분류 안 된 기사는 통과
        return sentimentFilter.has(articleWithSentiment.sentiment);
      });
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
          if (!article.publishedAt || !startDate) return false;
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
  }, [articles, selectedSource, sortOrder, searchMode, showBookmarksOnly, bookmarkedArticles, dateFilter, customStartDate, customEndDate, sentimentFilter]);

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

          {/* AI 검색 시 감성 필터 */}
          {searchMode === 'semantic' && (
            <div className={styles.sentimentFilterCompact}>
              <span className={styles.sentimentFilterLabel}>감성</span>
              <label className={styles.sentimentCheckbox} title="긍정 기사만">
                <input
                  type="checkbox"
                  checked={sentimentFilter.has('positive')}
                  onChange={(e) => handleSentimentFilterChange('positive', e.target.checked)}
                />
                <span className={styles.sentimentText}>긍정</span>
              </label>
              <label className={styles.sentimentCheckbox} title="부정 기사만">
                <input
                  type="checkbox"
                  checked={sentimentFilter.has('negative')}
                  onChange={(e) => handleSentimentFilterChange('negative', e.target.checked)}
                />
                <span className={styles.sentimentText}>부정</span>
              </label>
              <label className={styles.sentimentCheckbox} title="중립 기사만">
                <input
                  type="checkbox"
                  checked={sentimentFilter.has('neutral')}
                  onChange={(e) => handleSentimentFilterChange('neutral', e.target.checked)}
                />
                <span className={styles.sentimentText}>중립</span>
              </label>
            </div>
          )}
        </form>

        {/* 검색/분석 중 로딩 표시 */}
        {(loading || analysisLoading) && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSpinner}>
              <div className={styles.spinner}></div>
              <p className={styles.loadingText}>
                {loading ? '검색 중입니다...' : analysisStep || 'AI 분석 중...'}
              </p>
              <div className={styles.progressBar}>
                {analysisLoading && progressPercent > 0 ? (
                  <div
                    className={styles.progressFillReal}
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                ) : (
                  <div className={styles.progressFill}></div>
                )}
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
                  {/* 감성 배지 (AI 검색 + 분석 완료 시) */}
                  {searchMode === 'semantic' && analysisData && (article as any).sentiment && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: (article as any).sentiment === 'positive' ? '#e8f5e9' :
                                        (article as any).sentiment === 'negative' ? '#ffebee' : '#fff3e0',
                        color: (article as any).sentiment === 'positive' ? '#4caf50' :
                               (article as any).sentiment === 'negative' ? '#f44336' : '#ff9800'
                      }}>
                        {(article as any).sentiment === 'positive' ? '🟢 긍정' :
                         (article as any).sentiment === 'negative' ? '🔴 부정' : '🟡 중립'}
                      </span>
                    </div>
                  )}
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
        <div className={styles.modalOverlay}>
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

            {/* 탭 메뉴 */}
            <div style={{
              display: 'flex',
              borderBottom: '2px solid #e0e0e0',
              marginBottom: '24px'
            }}>
              <button
                onClick={() => setSettingsTab('auto-search')}
                style={{
                  flex: 1,
                  padding: '16px',
                  background: settingsTab === 'auto-search' ? 'white' : 'transparent',
                  border: 'none',
                  borderBottom: settingsTab === 'auto-search' ? '3px solid #667eea' : 'none',
                  fontWeight: settingsTab === 'auto-search' ? 600 : 400,
                  fontSize: '15px',
                  cursor: 'pointer',
                  color: settingsTab === 'auto-search' ? '#667eea' : '#666',
                  transition: 'all 0.2s'
                }}
              >
                🔍 자동 검색
              </button>
              <button
                onClick={() => setSettingsTab('lark')}
                style={{
                  flex: 1,
                  padding: '16px',
                  background: settingsTab === 'lark' ? 'white' : 'transparent',
                  border: 'none',
                  borderBottom: settingsTab === 'lark' ? '3px solid #667eea' : 'none',
                  fontWeight: settingsTab === 'lark' ? 600 : 400,
                  fontSize: '15px',
                  cursor: 'pointer',
                  color: settingsTab === 'lark' ? '#667eea' : '#666',
                  transition: 'all 0.2s'
                }}
              >
                🔔 Lark 알림
              </button>
              <button
                onClick={() => setSettingsTab('keywords')}
                style={{
                  flex: 1,
                  padding: '16px',
                  background: settingsTab === 'keywords' ? 'white' : 'transparent',
                  border: 'none',
                  borderBottom: settingsTab === 'keywords' ? '3px solid #667eea' : 'none',
                  fontWeight: settingsTab === 'keywords' ? 600 : 400,
                  fontSize: '15px',
                  cursor: 'pointer',
                  color: settingsTab === 'keywords' ? '#667eea' : '#666',
                  transition: 'all 0.2s'
                }}
              >
                🏷️ 감성 키워드
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* 자동 검색 설정 탭 */}
              {settingsTab === 'auto-search' && (
              <div className={styles.settingSection}>
                <h3 className={styles.sectionTitle}>자동 검색 설정</h3>

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

                <div className={styles.settingItem}>
                  <label htmlFor="max-articles" className={styles.settingLabel}>
                    최대 기사 수: <strong>{maxArticles}개</strong>
                  </label>
                  <select
                    id="max-articles"
                    value={maxArticles}
                    onChange={(e) => setMaxArticles(Number(e.target.value))}
                    className={styles.settingInput}
                  >
                    <option value={50}>50개 (빠름)</option>
                    <option value={100}>100개 (보통)</option>
                    <option value={200}>200개 (권장)</option>
                    <option value={300}>300개</option>
                    <option value={500}>500개</option>
                    <option value={1000}>1000개 (느림)</option>
                  </select>
                  <div className={styles.similarityHint}>
                    크롤링할 최대 기사 수입니다. 많을수록 검색 시간이 길어집니다.
                  </div>
                </div>
              </div>
              )}

              {/* Lark 알림 설정 탭 */}
              {settingsTab === 'lark' && (
              <div className={styles.settingSection}>
                <h3 className={styles.sectionTitle}>⚙️ 기본 설정</h3>

                <div className={styles.settingItem}>
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={larkEnabled}
                      onChange={(e) => setLarkEnabled(e.target.checked)}
                      className={styles.toggleCheckbox}
                    />
                    <span className={styles.toggleText}>정기 알림 활성화</span>
                  </label>
                  <p className={styles.helpText}>
                    활성화하면 설정한 주기마다 자동으로 뉴스를 분석하여 Lark로 전송합니다
                  </p>
                </div>

                <div className={styles.settingItem}>
                  <label className={styles.settingLabel}>Webhook URL *</label>
                  <input
                    type="text"
                    value={larkWebhookUrl}
                    onChange={(e) => setLarkWebhookUrl(e.target.value)}
                    placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/..."
                    className={styles.settingInput}
                  />
                  <p className={styles.helpText}>
                    Lark 봇 설정에서 Webhook URL을 복사하여 입력하세요
                  </p>
                </div>

                <div className={styles.settingItem}>
                  <label className={styles.settingLabel}>검색어 *</label>
                  <input
                    type="text"
                    value={larkQuery}
                    onChange={(e) => setLarkQuery(e.target.value)}
                    placeholder="예: AI 뉴스, 경제 동향, 기술 트렌드"
                    className={styles.settingInput}
                  />
                  <p className={styles.helpText}>
                    이 검색어로 뉴스를 수집하고 분석합니다
                  </p>
                </div>

                <h3 className={styles.sectionTitle} style={{ marginTop: '32px' }}>⏰ 알림 주기</h3>

                <div className={styles.settingItem}>
                  <label className={styles.settingLabel}>알림 주기</label>
                  <input
                    type="text"
                    value={larkScheduleText}
                    onChange={(e) => setLarkScheduleText(e.target.value)}
                    placeholder="예: 매일 오전 9시, 30분마다, 평일 오후 6시"
                    className={styles.settingInput}
                  />
                  <div className={styles.schedulePresets}>
                    {[
                      { label: '1분마다', value: '1분마다' },
                      { label: '매일 오전 9시', value: '매일 오전 9시' },
                      { label: '평일 오전 9시', value: '평일 오전 9시' },
                      { label: '6시간마다', value: '6시간마다' },
                      { label: '매주 월요일 9시', value: '매주 월요일 오전 9시' },
                    ].map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className={`${styles.schedulePresetChip} ${larkScheduleText === preset.value ? styles.schedulePresetActive : ''}`}
                        onClick={() => setLarkScheduleText(preset.value)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {larkScheduleText && (() => {
                    const parsed = parseNaturalSchedule(larkScheduleText);
                    if (parsed) {
                      return (
                        <p className={styles.helpText} style={{ color: 'var(--accent-color)' }}>
                          {parsed.description} — <code style={{ fontSize: '12px', opacity: 0.7 }}>{parsed.cron}</code>
                        </p>
                      );
                    }
                    return (
                      <p className={styles.helpText} style={{ color: '#e74c3c' }}>
                        인식할 수 없는 형식입니다. 예: 5분마다, 매일 오후 3시, 평일 오전 9시 30분
                      </p>
                    );
                  })()}
                </div>

                <h3 className={styles.sectionTitle} style={{ marginTop: '32px' }}>🎯 감성 필터</h3>

                <div className={styles.settingItem}>
                  <label className={styles.settingLabel}>알림받을 감성 유형</label>
                  <div className={styles.checkboxGroup}>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={larkSentimentTypes.has('negative')}
                        onChange={(e) => {
                          const newTypes = new Set(larkSentimentTypes);
                          if (e.target.checked) {
                            newTypes.add('negative');
                          } else {
                            newTypes.delete('negative');
                          }
                          setLarkSentimentTypes(newTypes);
                        }}
                      />
                      <span className={styles.sentimentBadge} style={{ backgroundColor: '#ffebee', color: '#f44336', padding: '6px 14px', borderRadius: '16px', fontWeight: 600, fontSize: '14px' }}>
                        🔴 부정 뉴스
                      </span>
                    </label>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={larkSentimentTypes.has('positive')}
                        onChange={(e) => {
                          const newTypes = new Set(larkSentimentTypes);
                          if (e.target.checked) {
                            newTypes.add('positive');
                          } else {
                            newTypes.delete('positive');
                          }
                          setLarkSentimentTypes(newTypes);
                        }}
                      />
                      <span className={styles.sentimentBadge} style={{ backgroundColor: '#e8f5e9', color: '#4caf50', padding: '6px 14px', borderRadius: '16px', fontWeight: 600, fontSize: '14px' }}>
                        🟢 긍정 뉴스
                      </span>
                    </label>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={larkSentimentTypes.has('neutral')}
                        onChange={(e) => {
                          const newTypes = new Set(larkSentimentTypes);
                          if (e.target.checked) {
                            newTypes.add('neutral');
                          } else {
                            newTypes.delete('neutral');
                          }
                          setLarkSentimentTypes(newTypes);
                        }}
                      />
                      <span className={styles.sentimentBadge} style={{ backgroundColor: '#fff3e0', color: '#ff9800', padding: '6px 14px', borderRadius: '16px', fontWeight: 600, fontSize: '14px' }}>
                        🟡 중립 뉴스
                      </span>
                    </label>
                  </div>
                  <p className={styles.helpText}>
                    선택한 감성의 기사만 Lark로 전송됩니다
                  </p>
                </div>

                <div className={styles.settingItem}>
                  <label className={styles.settingLabel}>최대 기사 수</label>
                  <select
                    value={maxArticles}
                    onChange={(e) => setMaxArticles(Number(e.target.value))}
                    className={styles.settingInput}
                  >
                    <option value={50}>50개 (빠름)</option>
                    <option value={100}>100개 (보통)</option>
                    <option value={200}>200개 (권장)</option>
                    <option value={300}>300개</option>
                    <option value={500}>500개</option>
                  </select>
                  <p className={styles.helpText}>
                    크롤링할 최대 기사 수입니다. Lark 메시지에는 상위 10개만 전송됩니다
                  </p>
                </div>

                <h3 className={styles.sectionTitle} style={{ marginTop: '32px' }}>🧪 테스트</h3>

                <div className={styles.settingItem}>
                  <button
                    onClick={handleSendTestLark}
                    disabled={larkTestLoading || !larkWebhookUrl || !larkQuery}
                    className={styles.testButton}
                    style={{
                      width: '100%',
                      padding: '14px 24px',
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: larkTestLoading || !larkWebhookUrl || !larkQuery ? 'not-allowed' : 'pointer',
                      opacity: larkTestLoading || !larkWebhookUrl || !larkQuery ? 0.5 : 1
                    }}
                  >
                    {larkTestLoading ? '전송 중...' : '테스트 전송'}
                  </button>
                  <p className={styles.helpText}>
                    현재 설정으로 Lark 메시지를 즉시 전송해봅니다
                  </p>
                  {larkTestMessage && (
                    <div style={{
                      padding: '12px 16px',
                      background: larkTestMessage.startsWith('✅') ? '#e8f5e9' : '#ffebee',
                      border: `2px solid ${larkTestMessage.startsWith('✅') ? '#4caf50' : '#f44336'}`,
                      borderRadius: '8px',
                      color: larkTestMessage.startsWith('✅') ? '#2e7d32' : '#c62828',
                      fontWeight: 500,
                      textAlign: 'center',
                      marginTop: '12px'
                    }}>
                      {larkTestMessage}
                    </div>
                  )}
                </div>

                <div style={{
                  marginTop: '32px',
                  padding: '20px',
                  background: '#f8f9fa',
                  borderRadius: '12px',
                  border: '1px solid #e0e0e0'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#333' }}>💡 감성 분류 기준</h4>
                  <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#555' }}>
                    <p style={{ margin: '0 0 12px 0' }}>AI가 뉴스 전체를 분석하여 감성을 판단합니다:</p>
                    <ol style={{ margin: '0', paddingLeft: '20px' }}>
                      <li style={{ marginBottom: '8px' }}><strong>긍정/부정 키워드 추출:</strong> AI가 "긍정적 측면"과 "부정적 측면"에서 키워드를 추출합니다</li>
                      <li style={{ marginBottom: '8px' }}><strong>기사별 매칭:</strong> 각 기사의 제목과 본문에서 키워드가 얼마나 나타나는지 카운트합니다</li>
                      <li style={{ marginBottom: '8px' }}><strong>감성 결정:</strong>
                        <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                          <li>긍정 키워드 &gt; 부정 키워드 → <strong style={{ color: '#4caf50' }}>긍정</strong></li>
                          <li>부정 키워드 &gt; 긍정 키워드 → <strong style={{ color: '#f44336' }}>부정</strong></li>
                          <li>비슷하거나 키워드 없음 → <strong style={{ color: '#ff9800' }}>중립</strong></li>
                        </ul>
                      </li>
                    </ol>
                    <p style={{ marginTop: '12px', fontSize: '13px', color: '#666' }}>
                      예시: AI가 "경제 성장, 투자 증가"를 긍정 키워드로, "위험 증가, 규제 강화"를 부정 키워드로 추출했다면,
                      "경제 성장과 투자 증가"가 포함된 기사는 긍정으로 분류됩니다.
                    </p>
                  </div>
                </div>
              </div>
              )}

              {/* 감성 키워드 설정 탭 */}
              {settingsTab === 'keywords' && (
              <div className={styles.settingSection}>
                {/* 부정 키워드 */}
                <div className={styles.keywordSection}>
                  <h4 className={styles.keywordSectionTitle}>🔴 부정 키워드</h4>
                  <div className={styles.keywordChips}>
                    {customNegativeKeywords.map((kw, i) => (
                      <span key={i} className={`${styles.keywordChip} ${styles.keywordChipNegative}`}>
                        {kw}
                        <button
                          type="button"
                          className={styles.keywordChipDelete}
                          onClick={() => setCustomNegativeKeywords(prev => prev.filter((_, idx) => idx !== i))}
                          aria-label={`${kw} 삭제`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {customNegativeKeywords.length === 0 && (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>키워드가 없습니다</span>
                    )}
                  </div>
                  <div className={styles.keywordInputRow}>
                    <input
                      type="text"
                      value={newNegativeKeyword}
                      onChange={(e) => setNewNegativeKeyword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newNegativeKeyword.trim()) {
                          e.preventDefault();
                          const kw = newNegativeKeyword.trim();
                          if (!customNegativeKeywords.includes(kw)) {
                            setCustomNegativeKeywords(prev => [...prev, kw]);
                          }
                          setNewNegativeKeyword('');
                        }
                      }}
                      placeholder="새 부정 키워드 입력..."
                      className={styles.keywordInput}
                    />
                    <button
                      type="button"
                      className={styles.keywordAddButton}
                      onClick={() => {
                        const kw = newNegativeKeyword.trim();
                        if (kw && !customNegativeKeywords.includes(kw)) {
                          setCustomNegativeKeywords(prev => [...prev, kw]);
                          setNewNegativeKeyword('');
                        }
                      }}
                    >
                      추가
                    </button>
                  </div>
                </div>

                {/* 긍정 키워드 */}
                <div className={styles.keywordSection}>
                  <h4 className={styles.keywordSectionTitle}>🟢 긍정 키워드</h4>
                  <div className={styles.keywordChips}>
                    {customPositiveKeywords.map((kw, i) => (
                      <span key={i} className={`${styles.keywordChip} ${styles.keywordChipPositive}`}>
                        {kw}
                        <button
                          type="button"
                          className={styles.keywordChipDelete}
                          onClick={() => setCustomPositiveKeywords(prev => prev.filter((_, idx) => idx !== i))}
                          aria-label={`${kw} 삭제`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {customPositiveKeywords.length === 0 && (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>키워드가 없습니다</span>
                    )}
                  </div>
                  <div className={styles.keywordInputRow}>
                    <input
                      type="text"
                      value={newPositiveKeyword}
                      onChange={(e) => setNewPositiveKeyword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newPositiveKeyword.trim()) {
                          e.preventDefault();
                          const kw = newPositiveKeyword.trim();
                          if (!customPositiveKeywords.includes(kw)) {
                            setCustomPositiveKeywords(prev => [...prev, kw]);
                          }
                          setNewPositiveKeyword('');
                        }
                      }}
                      placeholder="새 긍정 키워드 입력..."
                      className={styles.keywordInput}
                    />
                    <button
                      type="button"
                      className={styles.keywordAddButton}
                      onClick={() => {
                        const kw = newPositiveKeyword.trim();
                        if (kw && !customPositiveKeywords.includes(kw)) {
                          setCustomPositiveKeywords(prev => [...prev, kw]);
                          setNewPositiveKeyword('');
                        }
                      }}
                    >
                      추가
                    </button>
                  </div>
                </div>

                {/* 기본값으로 초기화 */}
                <button
                  type="button"
                  className={styles.keywordResetButton}
                  onClick={() => {
                    if (confirm('키워드를 기본값으로 초기화하시겠습니까?')) {
                      setCustomPositiveKeywords([...defaultPositiveKeywords]);
                      setCustomNegativeKeywords([...defaultNegativeKeywords]);
                    }
                  }}
                >
                  🔄 기본값으로 초기화
                </button>
              </div>
              )}
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
