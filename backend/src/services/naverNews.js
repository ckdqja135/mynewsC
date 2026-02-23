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
        const $item = $link.closest('[class*="YWTMk"], [class*="item"], div[class*="vertical-layout"]').first();

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
        // 1차: class에 "text", "time", "date", "info" 포함된 요소 검색
        $item.find('[class*="text"], [class*="time"], [class*="date"], [class*="info"], [class*="sub"]').each((_, el) => {
          const text = $(el).text().trim();
          if (datePattern.test(text)) {
            dateText = text;
            return false;
          }
        });
        // 2차: 못 찾으면 span, em 등 인라인 요소에서 검색
        if (!dateText) {
          $item.find('span, em').each((_, el) => {
            const text = $(el).text().trim();
            if (datePattern.test(text)) {
              dateText = text;
              return false;
            }
          });
        }

        const publishedAt = dateText ? parsePublishedDate(dateText, 'naver') : null;

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

        // Find thumbnail image (article image, not publisher logo)
        // Image is in parent container (sds-comps-base-layout), not in $item itself
        let thumbnail = null;
        const $articleContainer = $item.parent();
        const $imgTarget = $articleContainer.length > 0 ? $articleContainer : $item;
        $imgTarget.find('img[src^="http"]').each((_, el) => {
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
