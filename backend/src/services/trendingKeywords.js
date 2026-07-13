/**
 * Trending Keywords Service
 *
 * 외부 "실시간 핫 키워드"(급상승 검색어)를 수집하는 서비스.
 *
 * 네이버 실시간 검색어가 2021년 폐지되어, 다음 두 소스를 사용한다:
 *   1) signal.bz  — 실시간 검색어 top10 (JSON). 순위변동(state) 정보 포함.
 *                   https://api.signal.bz/news/realtime
 *   2) Google Trends — 국가별 급상승 검색어 RSS (fallback).
 *                   https://trends.google.com/trending/rss?geo=KR
 *
 * 기본 동작(source: 'auto')은 signal.bz를 먼저 시도하고, 실패하면 Google Trends로
 * 폴백한다. 두 소스 모두 실패하면 에러를 던진다.
 *
 * 반환 형식(정규화):
 *   {
 *     source: 'signal.bz' | 'Google Trends',
 *     fetchedAt: ISO8601,
 *     count: number,
 *     items: [
 *       { rank, keyword, state, stateEmoji, stateLabel, traffic }
 *     ]
 *   }
 */

const axios = require('axios');
const Parser = require('rss-parser');

class TrendingKeywordsService {
  constructor() {
    this.signalUrl = 'https://api.signal.bz/news/realtime';
    this.googleTrendsUrl = 'https://trends.google.com/trending/rss';

    // Google Trends RSS 파싱용. ht: 네임스페이스 커스텀 필드를 매핑한다.
    this.parser = new Parser({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsCrawler/1.0)',
      },
      customFields: {
        item: [
          ['ht:approx_traffic', 'approxTraffic'],
        ],
      },
    });
  }

  /**
   * signal.bz의 순위변동 상태 코드를 표시용 이모지/라벨로 변환.
   * n: 신규 진입, +: 순위 상승, -: 순위 하락, s: 순위 유지
   * @param {string} state
   * @returns {{ emoji: string, label: string }}
   */
  mapSignalState(state) {
    switch (state) {
      case 'n':
        return { emoji: '🆕', label: 'NEW' };
      case '+':
        return { emoji: '🔺', label: '상승' };
      case '-':
        return { emoji: '🔻', label: '하락' };
      case 's':
        return { emoji: '➖', label: '유지' };
      default:
        return { emoji: '•', label: '' };
    }
  }

  /**
   * signal.bz 실시간 검색어 top10 수집.
   * @param {number} limit - 최대 개수
   * @returns {Promise<{ source: string, items: Array }>}
   */
  async fetchFromSignal(limit = 10) {
    const res = await axios.get(this.signalUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsCrawler/1.0)',
        // signal.bz는 Referer가 없으면 차단하는 경우가 있어 명시한다.
        Referer: 'https://signal.bz/',
      },
    });

    const data = res.data || {};
    const list = Array.isArray(data.top10) ? data.top10 : [];
    if (list.length === 0) {
      throw new Error('signal.bz returned no keywords');
    }

    const items = list
      .filter((it) => it && it.keyword)
      .slice(0, limit)
      .map((it, idx) => {
        const s = this.mapSignalState(it.state);
        return {
          rank: typeof it.rank === 'number' ? it.rank : idx + 1,
          keyword: String(it.keyword).trim(),
          state: it.state || null,
          stateEmoji: s.emoji,
          stateLabel: s.label,
          traffic: null,
        };
      });

    return { source: 'signal.bz', items };
  }

  /**
   * Google Trends 급상승 검색어 RSS 수집 (fallback).
   * @param {number} limit - 최대 개수
   * @param {string} geo - 국가 코드 (기본 KR)
   * @returns {Promise<{ source: string, items: Array }>}
   */
  async fetchFromGoogleTrends(limit = 10, geo = 'KR') {
    const url = `${this.googleTrendsUrl}?geo=${encodeURIComponent(geo)}`;
    const feed = await this.parser.parseURL(url);
    const list = Array.isArray(feed.items) ? feed.items : [];
    if (list.length === 0) {
      throw new Error('Google Trends returned no keywords');
    }

    const items = list
      .filter((it) => it && it.title)
      .slice(0, limit)
      .map((it, idx) => ({
        rank: idx + 1,
        keyword: String(it.title).trim(),
        // Google Trends는 순위변동 정보를 제공하지 않으므로 🔥로 통일
        state: null,
        stateEmoji: '🔥',
        stateLabel: '',
        // 대략적인 검색량 (예: "2000+")
        traffic: it.approxTraffic ? String(it.approxTraffic).trim() : null,
      }));

    return { source: 'Google Trends', items };
  }

  /**
   * 실시간 핫 키워드 조회.
   * @param {Object} [opts]
   * @param {number} [opts.limit=10] - 최대 키워드 수 (1~20)
   * @param {string} [opts.source='auto'] - 'auto' | 'signal' | 'google'
   * @param {string} [opts.geo='KR'] - Google Trends용 국가 코드
   * @returns {Promise<{ source, fetchedAt, count, items }>}
   */
  async getTrending({ limit = 10, source = 'auto', geo = 'KR' } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 20);

    const trySignal = () => this.fetchFromSignal(safeLimit);
    const tryGoogle = () => this.fetchFromGoogleTrends(safeLimit, geo);

    // source에 따라 시도 순서 결정. 'auto'는 signal 우선 → google 폴백.
    let order;
    if (source === 'signal') {
      order = [trySignal];
    } else if (source === 'google') {
      order = [tryGoogle];
    } else {
      order = [trySignal, tryGoogle];
    }

    const errors = [];
    for (const fn of order) {
      try {
        const result = await fn();
        return {
          source: result.source,
          fetchedAt: new Date().toISOString(),
          count: result.items.length,
          items: result.items,
        };
      } catch (err) {
        console.error('[Trending] Source failed:', err.message);
        errors.push(err.message);
      }
    }

    throw new Error(`All trending sources failed: ${errors.join(' | ')}`);
  }
}

module.exports = { TrendingKeywordsService };
