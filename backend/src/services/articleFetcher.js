const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const FETCH_TIMEOUT = 5000;

const CLEAN_PATTERNS = [
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, // 이메일
  /무단\s*전재[^\n]*/g,                                   // 무단 전재 금지
  /저작권자\s*©?[^\n]*금지[^\n]*/g,                       // 저작권자 ~~ 금지
  /©\s*\d{4}[^\n]*/g,                                    // © 2024 ...
  /\[\s*[가-힣]+\s*기자\s*\]/g,                           // [홍길동 기자]
];

/**
 * 기사 URL에서 본문 텍스트를 추출하고 정제합니다.
 * @mozilla/readability (Firefox Reader Mode 알고리즘) 사용.
 * @param {string} url
 * @returns {Promise<string|null>} 정제된 본문, 실패 시 null
 */
async function fetchArticleBody(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      timeout: FETCH_TIMEOUT,
      maxRedirects: 5,
    });

    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();

    if (!parsed || !parsed.textContent) return null;

    let text = parsed.textContent;

    // 보일러플레이트 패턴 제거
    for (const pattern of CLEAN_PATTERNS) {
      text = text.replace(pattern, '');
    }

    // 공백/줄바꿈 정리
    text = text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    // 너무 짧으면 본문 추출 실패로 간주
    if (text.length < 200) return null;

    return text;
  } catch {
    return null;
  }
}

/**
 * 여러 기사 본문을 병렬로 fetch합니다.
 * 각 기사에 fullText 필드를 추가하여 반환.
 * @param {Array} articles
 * @returns {Promise<Array>} fullText 필드가 추가된 기사 배열
 */
async function fetchArticleBodies(articles) {
  const results = await Promise.allSettled(
    articles.map(a => fetchArticleBody(a.url))
  );

  return articles.map((article, i) => ({
    ...article,
    fullText: results[i].status === 'fulfilled' ? results[i].value : null,
  }));
}

module.exports = { fetchArticleBody, fetchArticleBodies };
