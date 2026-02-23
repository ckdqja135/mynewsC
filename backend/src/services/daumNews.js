const axios = require('axios');
const cheerio = require('cheerio');
const { generateNewsId } = require('../utils/idGenerator');
const { parsePublishedDate } = require('../utils/dateParser');

class DaumNewsService {
  constructor() {
    this.searchUrl = 'https://search.daum.net/search';
    this.delay = 200;
    this.batchSize = 5;
  }

  /**
   * Search news by scraping search.daum.net HTML.
   * Uses parallel batch requests for speed.
   * @param {string} query - Search query
   * @param {number} maxResults - Maximum number of articles to return
   * @returns {Promise<Array>} - Array of article objects
   */
  async searchNews(query, maxResults = 500) {
    const resultsPerPage = 10;
    const pagesNeeded = Math.ceil(maxResults / resultsPerPage);
    const allArticles = [];

    for (let batchStart = 0; batchStart < pagesNeeded; batchStart += this.batchSize) {
      const batchEnd = Math.min(batchStart + this.batchSize, pagesNeeded);
      const batchPromises = [];

      for (let page = batchStart; page < batchEnd; page++) {
        const pageNum = page + 1;
        batchPromises.push(this._fetchPage(query, pageNum));
      }

      const results = await Promise.allSettled(batchPromises);
      let gotResults = false;

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          allArticles.push(...result.value);
          gotResults = true;
        }
      }

      if (!gotResults) break;
      if (allArticles.length >= maxResults) break;

      if (batchStart + this.batchSize < pagesNeeded) {
        await new Promise(resolve => setTimeout(resolve, this.delay));
      }
    }

    return allArticles.slice(0, maxResults);
  }

  async _fetchPage(query, page) {
    try {
      const response = await axios.get(this.searchUrl, {
        params: {
          w: 'news',
          q: query,
          p: page,
          sort: 'recency', // 최신순
        },
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        timeout: 15000,
      });

      return this._parseSearchPage(response.data);
    } catch {
      return [];
    }
  }

  _parseSearchPage(html) {
    const $ = cheerio.load(html);
    const articles = [];

    // Daum news articles are <li> elements with data-docid attribute
    $('[data-docid]').each((_, el) => {
      try {
        const $el = $(el);

        // Find title: link to v.daum.net/v/ with text >= 15 chars
        let title = '';
        let url = '';
        let snippet = '';
        $el.find('a[href*="v.daum.net/v/"]').each((_, a) => {
          const text = $(a).text().trim();
          const href = $(a).attr('href') || '';
          if (!url && text.length >= 10 && text.length < 200) {
            title = text;
            url = href;
          } else if (url && href === url && text.length > title.length) {
            // Longer text for same URL = snippet
            snippet = text;
          }
        });

        if (!title || !url) return;

        // Source: first link to v.daum.net/channel/
        let source = 'Daum';
        const $sourceLink = $el.find('a[href*="v.daum.net/channel"]').first();
        if ($sourceLink.length > 0) {
          source = $sourceLink.text().trim() || 'Daum';
        }

        // Date: span with class txt_info containing date pattern
        const datePattern = /^\d{4}\.\d{1,2}\.\d{1,2}\.?$|^\d+초?\s*전$|^\d+분\s*전$|^\d+시간\s*전$|^\d+일\s*전$|^\d+주\s*전$/;
        let dateText = '';
        $el.find('span.txt_info, .gem-subinfo, [class*="date"], [class*="time"], [class*="info"]').each((_, span) => {
          const text = $(span).text().trim();
          if (datePattern.test(text)) {
            dateText = text;
            return false;
          }
        });
        // Fallback: search all spans
        if (!dateText) {
          $el.find('span, em').each((_, span) => {
            const text = $(span).text().trim();
            if (datePattern.test(text)) {
              dateText = text;
              return false;
            }
          });
        }

        const publishedAt = dateText ? parsePublishedDate(dateText, 'daum') : null;

        if (snippet.length > 300) snippet = snippet.substring(0, 300);
        const articleId = generateNewsId(url, title);

        articles.push({
          id: articleId,
          title,
          url,
          source,
          publishedAt: publishedAt ? publishedAt.toISOString() : null,
          snippet: snippet || null,
          thumbnail: null,
        });
      } catch {
        // Skip
      }
    });

    return articles;
  }
}

module.exports = { DaumNewsService };
