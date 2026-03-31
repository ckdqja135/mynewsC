const cheerio = require('cheerio');

const FETCH_TIMEOUT = 3000;
const MAX_ENRICH = 20;

const JUNK_PATTERNS = [
  'comprehensive up-to-date news coverage',
  'google news',
];

/**
 * Search DuckDuckGo and return { url, snippet } in one request.
 */
async function searchDDG(title, source) {
  try {
    const query = `${title} ${source}`;
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Find first valid result
    let result = null;
    $('.result').each((_, el) => {
      const $el = $(el);
      const href = $el.find('a.result__a').attr('href') || '';
      const match = href.match(/uddg=(https?[^&]+)/);
      if (!match) return;

      const url = decodeURIComponent(match[1]);
      if (url.includes('google.com') || url.includes('youtube.com')) return;

      let snippet = $el.find('.result__snippet').text().trim();
      // Filter out encoding-broken text
      if (snippet.includes('\ufffd') || (snippet.match(/[\u0080-\u00ff]/g) || []).length > snippet.length * 0.1) {
        snippet = '';
      }
      result = { url, snippet: snippet.length >= 20 ? snippet : null };
      return false;
    });

    return result;
  } catch {
    return null;
  }
}

/**
 * Fetch og:description from article page (for non-Google articles).
 */
async function fetchMetaDescription(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    const ogDesc = ($('meta[property="og:description"]').attr('content') || '').trim();
    const metaDesc = ($('meta[name="description"]').attr('content') ||
                      $('meta[name="Description"]').attr('content') || '').trim();

    const candidates = [metaDesc, ogDesc].filter(d => d.length >= 15);
    if (candidates.length === 0) return null;

    let text = candidates.sort((a, b) => b.length - a.length)[0];
    text = text.replace(/\u00a0/g, ' ').trim();
    if (text.length > 300) text = text.substring(0, 300);

    const lower = text.toLowerCase();
    if (JUNK_PATTERNS.some(junk => lower.includes(junk))) return null;

    return text;
  } catch {
    return null;
  }
}

/**
 * Enrich a single article.
 * Google News: 1 DDG request (URL + snippet).
 * Others: 1 article page request (meta description).
 */
async function fetchSnippetForArticle(article) {
  const isGoogleNews = article.url && article.url.includes('news.google.com');

  if (isGoogleNews) {
    const result = await searchDDG(article.title, article.source);
    if (result) {
      article.url = result.url;
      return result.snippet;
    }
    return null;
  }

  return fetchMetaDescription(article.url);
}

/**
 * Enrich articles whose snippet is missing or title-like.
 */
async function enrichSnippets(articles) {
  const needsEnrichment = articles.map((article, idx) => {
    if (!article.snippet || isTitleLike(article.title, article.snippet)) {
      return idx;
    }
    return -1;
  }).filter(i => i >= 0).slice(0, MAX_ENRICH);

  if (needsEnrichment.length === 0) return articles;

  console.log(`[ENRICH] Enriching ${needsEnrichment.length}/${articles.length} articles...`);

  const results = await Promise.allSettled(
    needsEnrichment.map(idx => fetchSnippetForArticle(articles[idx]))
  );

  for (let j = 0; j < needsEnrichment.length; j++) {
    const idx = needsEnrichment[j];
    if (results[j].status === 'fulfilled' && results[j].value) {
      articles[idx].snippet = results[j].value;
    }
  }

  // Null out any snippet still title-like
  for (const article of articles) {
    if (article.snippet && isTitleLike(article.title, article.snippet)) {
      article.snippet = null;
    }
  }

  return articles;
}

function isTitleLike(title, snippet) {
  if (!title || !snippet) return true;
  const normalize = s => s.toLowerCase().replace(/[^\w가-힣a-z0-9]/g, '');
  const normTitle = normalize(title);
  const normSnippet = normalize(snippet);
  if (normTitle === normSnippet) return true;
  if (normSnippet.length < normTitle.length * 1.2) {
    if (normTitle.includes(normSnippet) || normSnippet.includes(normTitle)) return true;
  }
  return false;
}

/**
 * Infer article source from URL domain when source field is missing/generic.
 * @param {string} url
 * @returns {string|null}
 */
function inferSourceFromUrl(url) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.replace(/^(www|m|n|biz|news)\./i, '');
    const DOMAIN_MAP = {
      'naver.com': '네이버',
      'daum.net': '다음',
      'chosun.com': '조선일보',
      'joongang.co.kr': '중앙일보',
      'donga.com': '동아일보',
      'hani.co.kr': '한겨레',
      'khan.co.kr': '경향신문',
      'mt.co.kr': '머니투데이',
      'sedaily.com': '서울경제',
      'etnews.com': '전자신문',
      'yonhap.co.kr': '연합뉴스',
      'yna.co.kr': '연합뉴스',
      'mbc.co.kr': 'MBC',
      'kbs.co.kr': 'KBS',
      'sbs.co.kr': 'SBS',
    };
    return DOMAIN_MAP[hostname] || hostname.split('.')[0];
  } catch {
    return null;
  }
}

const LLM_SNIPPET_MAX = 30; // 최대 LLM 스니펫 생성 수 (API 호출 비용 제어)

/**
 * LLM fallback: generate short snippets for articles still missing one.
 * Capped at LLM_SNIPPET_MAX to avoid excessive API calls.
 * @param {Array} articles - mutable; sets article.snippet in-place
 * @param {object} llmService - CerebrasLLMService instance
 */
async function generateSnippetsWithLLM(articles, llmService) {
  const noSnippet = articles.filter(a => !a.snippet).slice(0, LLM_SNIPPET_MAX);
  if (noSnippet.length === 0 || !llmService) return;

  console.log(`[ENRICH] LLM snippet fallback for ${noSnippet.length} articles (capped at ${LLM_SNIPPET_MAX})`);

  const BATCH = 10;
  for (let i = 0; i < noSnippet.length; i += BATCH) {
    const batch = noSnippet.slice(i, i + BATCH);
    try {
      const snippets = await llmService.generateSnippets(batch);
      batch.forEach((a, j) => { if (snippets[j]) a.snippet = snippets[j]; });
    } catch (err) {
      console.warn(`[ENRICH] LLM snippet batch failed: ${err.message}`);
    }
  }
}

module.exports = { enrichSnippets, inferSourceFromUrl, generateSnippetsWithLLM };
