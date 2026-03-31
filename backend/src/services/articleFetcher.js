const axios = require('axios');
const cheerio = require('cheerio');
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
 * Phase 3 — Item 7: HTML 테이블을 "컬럼명: 값" 형식 텍스트로 변환
 * @param {string} html
 * @returns {string}
 */
function _extractTableText(html) {
  const $ = cheerio.load(html);
  const tableTexts = [];

  $('table').each((_, table) => {
    const $table = $(table);

    // thead 헤더 추출
    const headers = [];
    $table.find('thead tr th, thead tr td').each((_, th) => {
      headers.push($(th).text().trim());
    });

    // tbody 행 추출
    const rows = [];
    $table.find('tbody tr, tr').each((_, tr) => {
      if ($(tr).closest('thead').length > 0) return;
      const cells = [];
      $(tr).find('td, th').each((_, td) => cells.push($(td).text().replace(/\s+/g, ' ').trim()));
      if (cells.some(c => c.length > 0)) rows.push(cells);
    });

    // thead 없으면 첫 행을 헤더로 사용
    const effectiveHeaders = headers.length > 0 ? headers : (rows.length > 1 ? rows.shift() : []);

    if (rows.length === 0) return;

    const text = rows.map(row =>
      row.map((cell, i) => (effectiveHeaders[i] ? `${effectiveHeaders[i]}: ${cell}` : cell))
        .filter(t => t.trim() && t !== ': ')
        .join(' | ')
    ).filter(row => row.length > 0).join('\n');

    if (text.length > 30) tableTexts.push(text);
  });

  return tableTexts.join('\n\n');
}

/**
 * Phase 3 — Item 6: 이미지 alt 텍스트 + 캡션 추출
 * @param {string} html
 * @returns {string}
 */
function _extractImageText(html) {
  const $ = cheerio.load(html);
  const texts = [];
  const seen = new Set();

  // figure > figcaption 패턴
  $('figure').each((_, fig) => {
    const $fig = $(fig);
    const alt = ($fig.find('img').attr('alt') || '').trim();
    const caption = $fig.find('figcaption').text().trim();
    const parts = [alt, caption].filter(t => t.length > 5);
    if (parts.length === 0) return;
    const combined = parts.join(' — ');
    if (!seen.has(combined)) { seen.add(combined); texts.push(combined); }
  });

  // 독립 이미지 alt (로고/아이콘/광고 제외)
  $('img').each((_, img) => {
    if ($(img).closest('figure').length > 0) return;
    const alt = ($(img).attr('alt') || '').trim();
    if (alt.length > 10 && !/logo|icon|banner|btn|ad|광고|버튼/i.test(alt) && !seen.has(alt)) {
      seen.add(alt);
      texts.push(alt);
    }
  });

  return texts.join('\n');
}

/**
 * 기사 URL에서 본문 텍스트를 추출하고 정제합니다.
 * Readability 본문 + 테이블 데이터 + 이미지 설명을 합쳐서 반환.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function fetchArticleBody(url) {
  // Google News RSS redirect URLs cannot be fetched directly (JS-based redirect)
  if (!url || url.includes('news.google.com')) return null;

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

    const html = response.data;

    // 1. Readability로 본문 추출
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();

    if (!parsed || !parsed.textContent) return null;

    let text = parsed.textContent;

    // 보일러플레이트 패턴 제거
    for (const pattern of CLEAN_PATTERNS) {
      text = text.replace(pattern, '');
    }

    text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();

    if (text.length < 200) return null;

    // 2. 테이블 데이터 추가 (Item 7)
    const tableText = _extractTableText(html);
    if (tableText) text += '\n\n[표 데이터]\n' + tableText;

    // 3. 이미지 설명 추가 (Item 6)
    const imageText = _extractImageText(html);
    if (imageText) text += '\n\n[이미지 설명]\n' + imageText;

    return text;
  } catch (err) {
    console.warn(`[ArticleFetcher] Failed ${url?.slice(0, 80)}: ${err.code || err.message}`);
    return null;
  }
}

/**
 * 여러 기사 본문을 병렬로 fetch합니다.
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
