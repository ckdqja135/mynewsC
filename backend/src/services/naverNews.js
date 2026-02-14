const axios = require('axios');
const cheerio = require('cheerio');
const { generateNewsId } = require('../utils/idGenerator');
const { parsePublishedDate } = require('../utils/dateParser');

class NaverNewsService {
  constructor() {
    this.searchUrl = 'https://search.naver.com/search.naver';
    this.delay = 500; // ms between paginated requests
  }

  /**
   * Search news by scraping search.naver.com HTML.
   * @param {string} query - Search query
   * @param {number} maxResults - Maximum number of articles to return
   * @returns {Promise<Array>} - Array of article objects
   */
  async searchNews(query, maxResults = 100) {
    const articles = [];
    const resultsPerPage = 10;
    const pagesNeeded = Math.ceil(maxResults / resultsPerPage);

    for (let page = 0; page < pagesNeeded; page++) {
      const start = page * resultsPerPage + 1;

      try {
        const response = await axios.get(this.searchUrl, {
          params: {
            where: 'news',
            query,
            start,
            sort: 1, // 최신순
          },
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          },
          timeout: 15000,
        });

        const parsed = this._parseSearchPage(response.data);
        if (parsed.length === 0) break;

        articles.push(...parsed);

        if (articles.length >= maxResults) break;

        // Delay between requests to avoid IP blocking
        if (page < pagesNeeded - 1) {
          await new Promise(resolve => setTimeout(resolve, this.delay));
        }
      } catch (err) {
        if (page > 0) break;
        throw new Error(`Naver scraping failed: ${err.message}`);
      }
    }

    return articles.slice(0, maxResults);
  }

  /**
   * Parse a Naver news search result page.
   */
  _parseSearchPage(html) {
    const $ = cheerio.load(html);
    const articles = [];

    // Naver news search result items
    $('div.news_area, div.news_wrap').each((_, el) => {
      try {
        const $el = $(el);

        // Title and URL
        const $titleLink = $el.find('a.news_tit');
        const title = $titleLink.text().trim();
        const url = $titleLink.attr('href') || '';

        if (!title || !url) return;

        // Snippet / description
        const snippet = $el.find('div.news_dsc, a.api_txt_lines.dsc_txt_wrap').text().trim() || null;

        // Source name
        const source = $el.find('a.info.press').text().trim()
          || $el.find('span.info.press').text().trim()
          || 'naver';

        // Date info
        const dateText = $el.find('span.info').filter((_, span) => {
          const text = $(span).text();
          return /전|\./.test(text) && !/press/.test($(span).attr('class') || '');
        }).first().text().trim();

        const publishedAt = dateText ? parsePublishedDate(dateText, 'naver') : null;

        const articleId = generateNewsId(url, title);

        articles.push({
          id: articleId,
          title,
          url,
          source,
          publishedAt: publishedAt ? publishedAt.toISOString() : null,
          snippet,
          thumbnail: null,
        });
      } catch {
        // Skip malformed items
      }
    });

    return articles;
  }
}

module.exports = { NaverNewsService };
