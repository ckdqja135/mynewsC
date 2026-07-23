/**
 * Naver Section Trends
 *
 * 카테고리별 '인기 검색 키워드'를 만들기 위한 서비스.
 *
 * 실시간 검색어(signal.bz)는 '전체' 순위만 제공하고 카테고리별 조회를 지원하지 않는다.
 * 그래서 카테고리별 순위는 네이버 뉴스 '섹션'을 각각 독립적으로 조회한 뒤,
 * 해당 섹션의 최신 헤드라인에서 LLM으로 '그 분야 인기 검색 키워드'를 인기순으로 뽑아 만든다.
 *
 * 두 종류의 소스를 사용한다:
 *   1) 신규 섹션 페이지(UTF-8): news.naver.com/section/{sid}  — 정치/경제/사회/생활/국제/IT
 *   2) 구 리스트 페이지(EUC-KR): news.naver.com/main/list.naver?sid1={sid} — 연예/스포츠
 *      (연예·스포츠는 별도 도메인 SPA라 신규 섹션 페이지가 비어 있어 구 리스트를 사용)
 *
 * 반환 형식은 trendingKeywords 서비스와 동일하게 정규화한다:
 *   { rank, keyword, state, stateEmoji, stateLabel, traffic, category }
 */

const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

// 신규 섹션 페이지(UTF-8). '국제'는 네이버 '세계(104)' 섹션이다.
const SECTION_MAP = {
  '정치': 100,
  '경제': 101,
  '사회': 102,
  '생활': 103, // 생활/문화
  '국제': 104, // 네이버 '세계'
  'IT': 105,   // IT/과학
};

// 구 리스트 페이지(EUC-KR). 연예/스포츠는 별도 도메인이라 이 경로로 가져온다.
const LEGACY_MAP = {
  '연예': 106,
  '스포츠': 107,
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

class NaverSectionTrends {
  /**
   * @param {Object|null} llmService - extractTrendingKeywords 제공 (없으면 헤드라인 축약으로 폴백)
   */
  constructor(llmService) {
    this.llm = llmService;
    this.cache = new Map(); // category -> { at:number, items:Array }
    this.ttl = 5 * 60 * 1000; // 5분 캐시 (섹션 뉴스는 자주 안 바뀜)
    this.categories = [...Object.keys(SECTION_MAP), ...Object.keys(LEGACY_MAP)];
  }

  isSupported(category) {
    return SECTION_MAP[category] != null || LEGACY_MAP[category] != null;
  }

  /**
   * 신규 섹션 페이지(UTF-8)에서 헤드라인 파싱.
   * @param {number} sid
   * @returns {Promise<string[]>}
   */
  async _fetchSectionHeadlines(sid) {
    const url = `https://news.naver.com/section/${sid}`;
    const res = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    const $ = cheerio.load(res.data);
    const seen = new Set();
    const headlines = [];
    $('.sa_text_strong').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length >= 4 && !seen.has(t)) {
        seen.add(t);
        headlines.push(t);
      }
    });
    return headlines;
  }

  /**
   * 구 리스트 페이지(EUC-KR)에서 헤드라인 파싱 (연예/스포츠).
   * @param {number} sid
   * @returns {Promise<string[]>}
   */
  async _fetchLegacyHeadlines(sid) {
    const url = `https://news.naver.com/main/list.naver?mode=LSD&mid=sec&sid1=${sid}`;
    const res = await axios.get(url, {
      timeout: 10000,
      responseType: 'arraybuffer', // EUC-KR 원문 그대로 받아 직접 디코딩
      headers: { 'User-Agent': UA, Referer: 'https://news.naver.com/' },
    });
    const html = iconv.decode(Buffer.from(res.data), 'EUC-KR');
    const $ = cheerio.load(html);
    const seen = new Set();
    const headlines = [];
    // 구 리스트: ul.type06_headline / ul.type06 안의 li > dl > dt > a (제목)
    $('.type06_headline li dl, .type06 li dl').each((_, dl) => {
      // 이미지 dt(.photo)가 아닌 dt의 링크 텍스트가 제목
      let t = $(dl).find('dt:not(.photo) a').first().text().replace(/\s+/g, ' ').trim();
      if (!t) t = $(dl).find('dt a').last().text().replace(/\s+/g, ' ').trim();
      if (t && t.length >= 4 && !seen.has(t)) {
        seen.add(t);
        headlines.push(t);
      }
    });
    return headlines;
  }

  async _fetchHeadlines(category) {
    if (SECTION_MAP[category] != null) return this._fetchSectionHeadlines(SECTION_MAP[category]);
    if (LEGACY_MAP[category] != null) return this._fetchLegacyHeadlines(LEGACY_MAP[category]);
    return [];
  }

  // LLM이 없을 때 헤드라인을 대략적인 키워드로 축약하는 폴백
  _shortenHeadline(title) {
    const head = title.split(/[,·…:\-\[\]{}()“”"'’]/)[0].trim();
    return (head || title).slice(0, 20).trim();
  }

  /**
   * 카테고리별 인기 검색 키워드 조회 (캐시 사용).
   * @param {string} category
   * @param {number} limit
   * @returns {Promise<Array>} 정규화된 아이템 배열
   */
  async getCategoryTrends(category, limit = 10) {
    if (!this.isSupported(category)) {
      throw new Error(`Unsupported category: ${category}`);
    }
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 20);

    const cached = this.cache.get(category);
    if (cached && Date.now() - cached.at < this.ttl) {
      return cached.items.slice(0, safeLimit);
    }

    const headlines = await this._fetchHeadlines(category);
    if (headlines.length === 0) {
      throw new Error(`No headlines for section ${category}`);
    }

    let keywords = [];
    if (this.llm) {
      try {
        keywords = await this.llm.extractTrendingKeywords(headlines, category, safeLimit);
      } catch (err) {
        console.error(`[NaverSectionTrends] LLM extract failed for ${category}:`, err.message);
      }
    }
    // LLM 실패/미가용 시 헤드라인 축약으로 폴백
    if (!keywords || keywords.length === 0) {
      const seen = new Set();
      keywords = [];
      for (const h of headlines) {
        const kw = this._shortenHeadline(h);
        if (kw && !seen.has(kw)) {
          seen.add(kw);
          keywords.push(kw);
        }
        if (keywords.length >= safeLimit) break;
      }
    }

    const items = keywords.slice(0, safeLimit).map((kw, i) => ({
      rank: i + 1,
      keyword: kw,
      state: null,
      stateEmoji: '',
      stateLabel: '',
      traffic: null,
      category,
    }));

    this.cache.set(category, { at: Date.now(), items });
    return items;
  }
}

module.exports = { NaverSectionTrends, SECTION_MAP, LEGACY_MAP };
