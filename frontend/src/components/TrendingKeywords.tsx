'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { NewsApiService } from '@/services/newsApi';
import type { TrendingKeywordItem } from '@/types/news';
import styles from './TrendingKeywords.module.css';

// 자동 새로고침 주기 (5분). 실시간 트렌드지만 외부 소스 부하를 고려해 과하지 않게.
const REFRESH_INTERVAL = 5 * 60 * 1000;
// 사이드바에 표시할 키워드 개수 (텔레그램 기본값과 동일하게 10개).
const KEYWORD_LIMIT = 10;

interface TrendingKeywordsProps {
  // 키워드 클릭 시 호출 (검색 실행은 상위/페이지에서 처리)
  onKeywordClick: (keyword: string) => void;
}

export default function TrendingKeywords({ onKeywordClick }: TrendingKeywordsProps) {
  const [items, setItems] = useState<TrendingKeywordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await NewsApiService.getTrending({ limit: KEYWORD_LIMIT });
      setItems(Array.isArray(data.items) ? data.items : []);
      setSource(data.source || '');
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [load]);

  const timeLabel = updatedAt
    ? `${String(updatedAt.getHours()).padStart(2, '0')}:${String(updatedAt.getMinutes()).padStart(2, '0')} 기준`
    : '';

  return (
    <section className={styles.trending}>
      <div className={styles.header}>
        <span className={styles.title}>
          <span className="material-symbols-outlined">local_fire_department</span>
          실시간 인기 키워드
        </span>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={load}
          disabled={loading}
          title="새로고침"
          aria-label="실시간 인기 키워드 새로고침"
        >
          <span className={`material-symbols-outlined ${loading ? styles.spinning : ''}`}>
            refresh
          </span>
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className={styles.stateMsg}>불러오는 중…</div>
      ) : error && items.length === 0 ? (
        <div className={styles.stateMsg}>
          트렌드를 불러오지 못했습니다.
          <button type="button" className={styles.retryBtn} onClick={load}>
            다시 시도
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.stateMsg}>표시할 키워드가 없습니다.</div>
      ) : (
        <ol className={styles.list}>
          {items.map((it, idx) => (
            <li key={`${it.rank}-${it.keyword}-${idx}`}>
              <button
                type="button"
                className={styles.item}
                onClick={() => onKeywordClick(it.keyword)}
                title={`"${it.keyword}" 뉴스 검색`}
              >
                <span className={`${styles.rank} ${it.rank <= 3 ? styles.rankTop : ''}`}>
                  {it.rank}
                </span>
                <span className={styles.keyword}>{it.keyword}</span>
                {it.stateEmoji ? (
                  <span className={styles.badge} aria-hidden="true">
                    {it.stateEmoji}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      )}

      {items.length > 0 && (
        <Link href="/trending" className={styles.moreBtn}>
          <span className="material-symbols-outlined">add</span>
          더보기
        </Link>
      )}

      {updatedAt && items.length > 0 && (
        <div className={styles.footer}>
          {source && <span className={styles.sourceTag}>{source}</span>}
          <span className={styles.updated}>{timeLabel}</span>
        </div>
      )}
    </section>
  );
}
