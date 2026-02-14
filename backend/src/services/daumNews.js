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

    // Daum news search result items
    $('ul.list_news > li, div.wrap_cont').each((_, el) => {
      try {
        const $el = $(el);

        // Title and URL
        const $titleLink = $el.find('a.tit_main, a.link_txt, a.tit_g');
        const title = $titleLink.text().trim();
        const url = $titleLink.attr('href') || '';

        if (!title || !url) return;

        // Snippet
        const snippet = $el.find('p.desc, div.desc, span.txt_info').text().trim() || null;

        // Source name
        const source = $el.find('span.info_cp, a.info_cp, span.txt_cp').text().trim() || 'daum';

        // Date
        const dateText = $el.find('span.txt_info, span.info_time').filter((_, span) => {
          const text = $(span).text();
          return /전|\.|\-|시간|일/.test(text);
        }).first().text().trim();

        const publishedAt = dateText ? parsePublishedDate(dateText, 'daum') : null;
        const articleId = generateNewsId(url, title);

        articles.push({
          id: articleId,
          title,
          url,
          source: source || 'daum',
          publishedAt: publishedAt ? publishedAt.toISOString() : null,
          snippet,
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
