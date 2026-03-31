const axios = require('axios');
const cheerio = require('cheerio');
const { generateNewsId } = require('../utils/idGenerator');
const { parsePublishedDate } = require('../utils/dateParser');

class NaverNewsService {
  constructor() {
    this.searchUrl = 'https://search.naver.com/search.naver';
    this.delay = 200; // ms between batch requests
    this.batchSize = 5; // concurrent pages per batch
  }

  /**
   * Search news by scraping search.naver.com HTML.
   * Uses parallel batch requests for speed.
   * @param {string} query - Search query
   * @param {number} maxResults - Maximum number of articles to return
   * @returns {Promise<Array>} - Array of article objects
   */
  async searchNews(query, maxResults = 500) {
    const resultsPerPage = 10;
    const pagesNeeded = Math.ceil(maxResults / resultsPerPage);
    const allArticles = [];

    // Fetch pages in parallel batches
    for (let batchStart = 0; batchStart < pagesNeeded; batchStart += this.batchSize) {
      const batchEnd = Math.min(batchStart + this.batchSize, pagesNeeded);
      const batchPromises = [];

      for (let page = batchStart; page < batchEnd; page++) {
        const start = page * resultsPerPage + 1;
        batchPromises.push(this._fetchPage(query, start));
      }

      const results = await Promise.allSettled(batchPromises);
      let gotResults = false;

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          allArticles.push(...result.value);
          gotResults = true;
        }
      }

      // Stop if no results in this batch
      if (!gotResults) break;
      if (allArticles.length >= maxResults) break;

      // Small delay between batches to avoid blocking
      if (batchStart + this.batchSize < pagesNeeded) {
        await new Promise(resolve => setTimeout(resolve, this.delay));
      }
    }

    return allArticles.slice(0, maxResults);
  }

  async _fetchPage(query, start) {
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

      return this._parseSearchPage(response.data);
    } catch {
      return [];
    }
  }

  /**
   * Parse a Naver news search result page (updated for 2025 structure).
   */
  _parseSearchPage(html) {
    const $ = cheerio.load(html);
    const articles = [];
    const seenUrls = new Set();

    // Find article links first
    const articleLinks = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      // Match various article URL patterns
      if ((href.includes('/article/') || href.includes('article.php') || href.includes('articleView.html')) &&
          !href.includes('/press/') && !href.includes('naver.com') && !seenUrls.has(href)) {
        const $link = $(el);
        const linkText = $link.text().trim();

        // Check if this link might be a title (long enough text)
        if (linkText && linkText.length >= 15 && linkText.length < 200) {
          seenUrls.add(href);
          articleLinks.push({ url: href, title: linkText, $link });
        }
      }
    });

    // For each article link, try to find associated metadata
    articleLinks.forEach(({ url, title, $link }) => {
      try {
        // Find nearest parent that might contain metadata
        // YWTMk 컨테이너가 전체 기사(제목+소스+날짜+썸네일)를 포함
        // vertical-layout은 제목만 포함하는 내부 컨테이너이므로 제외
        const $item = $link.closest('[class*="YWTMk"], [class*="fds-news-item"]').first()
          || $link.closest('[class*="item"]').first();

        // Find source - look for press link in same container
        let source = 'Naver';
        const $pressLink = $item.find('a[href*="/press/"]').first();
        if ($pressLink.length > 0) {
          source = $pressLink.text().trim() || 'Naver';
        }
        // Fallback: extract from URL
        if (source === 'Naver' || !source) {
          try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.replace(/^www\.|^m\.|^n\.|^sports\.|^biz\./, '');
            source = hostname.split('.')[0];
            // Capitalize first letter
            source = source.charAt(0).toUpperCase() + source.slice(1);
          } catch (e) {
            source = 'Naver';
          }
        }

        // Find date - look for text matching time patterns
        const datePattern = /^\d+초?\s*전$|^\d+분\s*전$|^\d+시간\s*전$|^\d+일\s*전$|^\d+주\s*전$|^\d+개월\s*전$|^\d{4}\.\d{1,2}\.\d{1,2}\.?$/;
        let dateText = '';
        // $item 내에서 날짜 텍스트 검색 (span 우선)
        $item.find('span').each((_, el) => {
          const text = $(el).text().trim();
          if (datePattern.test(text)) {
            dateText = text;
            return false;
          }
        });

        const publishedAt = parsePublishedDate(dateText, 'naver', url);

        // Find snippet
        let snippet = '';
        $item.find('[class*="dsc"], [class*="desc"]').each((_, el) => {
          const text = $(el).text().trim();
          if (text.length > 20 && text !== title) {
            snippet = text;
            return false;
          }
        });
        if (snippet.length > 300) snippet = snippet.substring(0, 300);
        // Remove trailing source name and &nbsp;
        snippet = snippet.replace(/\u00a0/g, ' ').trim();
        if (source && source !== 'Naver') {
          const re = new RegExp(`\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
          snippet = snippet.replace(re, '').trim();
        }

        // Find thumbnail image (article image, not publisher logo)
        let thumbnail = null;
        $item.find('img[src^="http"]').each((_, el) => {
          if (thumbnail) return false;
          const src = $(el).attr('src') || '';
          if (src.includes('imgnews') && !src.includes('mimgnews') && !src.includes('office_logo')) {
            thumbnail = src;
            return false;
          }
        });

        const articleId = generateNewsId(url, title);

        articles.push({
          id: articleId,
          title,
          url,
          source,
          publishedAt: publishedAt ? publishedAt.toISOString() : null,
          snippet: snippet || null,
          thumbnail,
        });
      } catch (err) {
        // Skip errors
      }
    });

    return articles;
  }
}

module.exports = { NaverNewsService };
