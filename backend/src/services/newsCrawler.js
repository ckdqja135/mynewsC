const Parser = require('rss-parser');
const { generateNewsId } = require('../utils/idGenerator');
const { parsePublishedDate } = require('../utils/dateParser');

class NewsCrawler {
  constructor() {
    this.parser = new Parser({
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
  }

  /**
   * Search news using Google News RSS feed.
   * Fetches from multiple time-scoped queries to maximize results.
   * @param {string} query - Search query
   * @param {string} hl - Language code (e.g. 'ko')
   * @param {string} gl - Country code (e.g. 'kr')
   * @param {number} num - Maximum number of articles
   * @returns {Promise<Array>} - Array of article objects
   */
  async searchNews(query, hl = 'ko', gl = 'kr', num = 500) {
    const encodedQuery = encodeURIComponent(query);
    const ceid = `${gl.toUpperCase()}:${hl}`;

    // Fetch from multiple Google News RSS URLs to maximize results
    const base = `hl=${hl}&gl=${gl.toUpperCase()}&ceid=${ceid}`;
    const rssUrls = [
      // Default (recent)
      `https://news.google.com/rss/search?q=${encodedQuery}&${base}`,
      // Time ranges
      `https://news.google.com/rss/search?q=${encodedQuery}+when:1d&${base}`,
      `https://news.google.com/rss/search?q=${encodedQuery}+when:3d&${base}`,
      `https://news.google.com/rss/search?q=${encodedQuery}+when:7d&${base}`,
      `https://news.google.com/rss/search?q=${encodedQuery}+when:30d&${base}`,
      // If multi-word, also search with quotes for exact match
      ...(query.includes(' ') ? [
        `https://news.google.com/rss/search?q=%22${encodedQuery}%22&${base}`,
      ] : []),
      // Also try English locale for international coverage
      ...(hl !== 'en' ? [
        `https://news.google.com/rss/search?q=${encodedQuery}&hl=en&gl=US&ceid=US:en`,
      ] : []),
    ];

    const allArticles = [];

    const feedPromises = rssUrls.map(async (rssUrl) => {
      try {
        const feed = await this.parser.parseURL(rssUrl);
        const items = feed.items || [];
        const articles = [];
        for (const item of items) {
          const article = this._parseRssItem(item);
          if (article) articles.push(article);
        }
        return articles;
      } catch {
        return [];
      }
    });

    const results = await Promise.allSettled(feedPromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        allArticles.push(...result.value);
      }
    }

    // Deduplicate
    const seenIds = new Set();
    const unique = [];
    for (const article of allArticles) {
      if (!seenIds.has(article.id)) {
        seenIds.add(article.id);
        unique.push(article);
      }
    }

    // Sort newest first
    unique.sort((a, b) => {
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return dateB - dateA;
    });

    return unique.slice(0, num);
  }

  _parseRssItem(item) {
    try {
      const title = (item.title || '').trim();
      const rawLink = item.link || '';
      if (!title || !rawLink) return null;

      // Extract real URL from Google redirect
      const url = this._extractRealUrl(rawLink);

      // Source: Google RSS title format is "Article Title - Source Name"
      let sourceName = 'google';
      if (item.source) {
        sourceName = item.source;
      } else {
        const dashIdx = title.lastIndexOf(' - ');
        if (dashIdx > 0) {
          sourceName = title.substring(dashIdx + 3).trim();
        }
      }

      // Clean title (remove " - Source Name" suffix if present)
      let cleanTitle = title;
      const dashIdx = title.lastIndexOf(' - ');
      if (dashIdx > 0) {
        cleanTitle = title.substring(0, dashIdx).trim();
      }

      const publishedAt = item.pubDate
        ? parsePublishedDate(item.pubDate, sourceName)
        : null;

      const articleId = generateNewsId(url, cleanTitle);

      return {
        id: articleId,
        title: cleanTitle,
        url,
        source: sourceName,
        publishedAt: publishedAt ? publishedAt.toISOString() : null,
        snippet: this._cleanSnippet(item.contentSnippet || item.content || null, sourceName),
        thumbnail: null,
      };
    } catch {
      return null;
    }
  }

  _cleanSnippet(snippet, source) {
    if (!snippet) return null;
    let text = snippet.replace(/\u00a0/g, ' ').trim();
    if (source) {
      const re = new RegExp(`\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
      text = text.replace(re, '').trim();
    }
    return text || null;
  }

  /**
   * Extract the real URL from a Google News redirect URL.
   * Google News RSS links look like:
   *   https://news.google.com/rss/articles/CBMi...
   * or contain a url= query parameter.
   */
  _extractRealUrl(googleUrl) {
    try {
      const parsed = new URL(googleUrl);

      // Check for url query parameter
      const urlParam = parsed.searchParams.get('url');
      if (urlParam) return urlParam;

      // If it's a Google News redirect, return as-is (will redirect on click)
      return googleUrl;
    } catch {
      return googleUrl;
    }
  }
}

module.exports = { NewsCrawler };
