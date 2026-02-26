const cheerio = require('cheerio');

const FETCH_TIMEOUT = 4000;
const MAX_CONCURRENT = 10;
const MAX_ENRICH = 20; // Only enrich up to this many articles

// Junk descriptions to ignore
const JUNK_PATTERNS = [
  'comprehensive up-to-date news coverage',
  'google news',
];

/**
 * Search DuckDuckGo for the real article URL using title + source.
 */
async function searchRealArticle(title, source) {
  try {
    const query = `${title} ${source}`;
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    let realUrl = null;
    $('a.result__a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/uddg=(https?[^&]+)/);
      if (match) {
        const candidate = decodeURIComponent(match[1]);
        if (candidate.indexOf('google.com') === -1 &&
            candidate.indexOf('youtube.com') === -1) {
          realUrl = candidate;
          return false;
        }
      }
    });

    return realUrl;
  } catch {
    return null;
  }
}

/**
 * Fetch og:description from a URL. Optionally reuse pre-fetched html.
 */
async function fetchMetaDescription(html, url) {
  try {
    if (!html) {
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
      html = await res.text();
    }

    const $ = cheerio.load(html);

    const ogDesc = ($('meta[property="og:description"]').attr('content') || '').trim();
    const metaDesc = ($('meta[name="description"]').attr('content') ||
                      $('meta[name="Description"]').attr('content') || '').trim();

    // Prefer the longer description (meta description often has more detail)
    const candidates = [metaDesc, ogDesc].filter(d => d.length >= 15);
    if (candidates.length === 0) return null;

    // Pick the longest useful one
    let text = candidates.sort((a, b) => b.length - a.length)[0];
    text = text.replace(/\u00a0/g, ' ').replace(/&middot;/g, '·').trim();

    const lower = text.toLowerCase();
    if (JUNK_PATTERNS.some(junk => lower.includes(junk))) return null;

    if (text.length > 300) text = text.substring(0, 300);
    return text;
  } catch {
    return null;
  }
}

/**
 * Fetch snippet for a single article.
 * For Google News articles, searches for the real URL first.
 */
async function fetchSnippetForArticle(article) {
  const isGoogleNews = article.url && article.url.includes('news.google.com');

  if (isGoogleNews) {
    // Search Google for the real article URL
    const realUrl = await searchRealArticle(article.title, article.source);
    if (realUrl) {
      article.url = realUrl;
      return fetchMetaDescription(null, realUrl);
    }
    return null;
  }

  return fetchMetaDescription(null, article.url);
}

/**
 * Enrich articles with real snippets from og:description.
 * Only fetches for articles whose snippet is missing or looks like the title.
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

  // Process all in one parallel batch
  const results = await Promise.allSettled(
    needsEnrichment.map(idx => fetchSnippetForArticle(articles[idx]))
  );

  for (let j = 0; j < needsEnrichment.length; j++) {
    const idx = needsEnrichment[j];
    if (results[j].status === 'fulfilled' && results[j].value) {
      articles[idx].snippet = results[j].value;
    }
  }

  // Final pass: null out any snippet that's still title-like
  for (const article of articles) {
    if (article.snippet && isTitleLike(article.title, article.snippet)) {
      article.snippet = null;
    }
  }

  return articles;
}

/**
 * Check if snippet is essentially the same as the title.
 */
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

module.exports = { enrichSnippets };
