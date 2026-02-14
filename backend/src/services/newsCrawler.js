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
   * @param {string} query - Search query
   * @param {string} hl - Language code (e.g. 'ko')
   * @param {string} gl - Country code (e.g. 'kr')
   * @param {number} num - Maximum number of articles
   * @returns {Promise<Array>} - Array of article objects
   */
  async searchNews(query, hl = 'ko', gl = 'kr', num = 100) {
    const encodedQuery = encodeURIComponent(query);
    const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=${hl}&gl=${gl.toUpperCase()}&ceid=${gl.toUpperCase()}:${hl}`;

    try {
      const feed = await this.parser.parseURL(rssUrl);
      const items = feed.items || [];

      const articles = [];
      for (const item of items) {
        if (articles.length >= num) break;
        const article = this._parseRssItem(item);
        if (article) articles.push(article);
      }

      // Deduplicate
      const seenIds = new Set();
      const unique = [];
      for (const article of articles) {
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

      return unique;
    } catch (err) {
      throw new Error(`Google News RSS fetch failed: ${err.message}`);
    }
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
        snippet: item.contentSnippet || item.content || null,
        thumbnail: null,
      };
    } catch {
      return null;
    }
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
