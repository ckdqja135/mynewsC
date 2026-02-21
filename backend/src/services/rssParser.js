const Parser = require('rss-parser');
const cheerio = require('cheerio');
const { generateNewsId } = require('../utils/idGenerator');
const { parsePublishedDate } = require('../utils/dateParser');

class RSSParserService {
  constructor() {
    this.parser = new Parser({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsCrawler/1.0)',
      },
      customFields: {
        item: [
          ['media:content', 'media:content', { keepArray: true }],
          ['media:thumbnail', 'media:thumbnail', { keepArray: true }],
        ],
      },
    });

    // 한국 RSS 피드 (키워드 필터 없이 전체 수집)
    this.KOREAN_FEEDS = {
      '연합뉴스': 'https://www.yonhapnewstv.co.kr/category/news/headline/feed/',
      'KBS': 'https://news.kbs.co.kr/rss/headline.xml',
      'KBS 경제': 'https://news.kbs.co.kr/rss/economy.xml',
      'KBS 사회': 'https://news.kbs.co.kr/rss/society.xml',
      'KBS 국제': 'https://news.kbs.co.kr/rss/international.xml',
      'MBC': 'https://imnews.imbc.com/rss/news/news_00.xml',
      'SBS': 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01',
      'SBS 경제': 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02',
      'SBS IT/과학': 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=08',
      'JTBC': 'https://fs.jtbc.co.kr/RSS/newsflash.xml',
      '한겨레': 'https://www.hani.co.kr/rss/',
      '경향신문': 'https://www.khan.co.kr/rss/rssdata/total_news.xml',
      '조선일보': 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml',
      '중앙일보': 'https://rss.joins.com/joins_news_list.xml',
      '동아일보': 'https://rss.donga.com/total.xml',
      '매일경제': 'https://www.mk.co.kr/rss/30000001/',
      '한국경제': 'https://www.hankyung.com/feed/all-news',
      'YTN': 'https://www.ytn.co.kr/rss/headline.xml',
      'MBN': 'https://www.mbn.co.kr/rss/',
    };

    // 해외 RSS 피드 (키워드 필터 적용)
    this.INTL_FEEDS = {
      // CNN
      'CNN': 'http://rss.cnn.com/rss/edition.rss',
      'CNN World': 'http://rss.cnn.com/rss/edition_world.rss',
      'CNN US': 'http://rss.cnn.com/rss/edition_us.rss',
      'CNN Tech': 'http://rss.cnn.com/rss/edition_technology.rss',

      // BBC
      'BBC World': 'http://feeds.bbci.co.uk/news/world/rss.xml',
      'BBC Business': 'http://feeds.bbci.co.uk/news/business/rss.xml',
      'BBC Tech': 'http://feeds.bbci.co.uk/news/technology/rss.xml',
      'BBC Science': 'http://feeds.bbci.co.uk/news/science_and_environment/rss.xml',

      // Reuters
      'Reuters': 'https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best',
      'Reuters World': 'https://www.reuters.com/rssFeed/worldNews',
      'Reuters Business': 'https://www.reuters.com/rssFeed/businessNews',
      'Reuters Tech': 'https://www.reuters.com/rssFeed/technologyNews',

      // AP News
      'AP News': 'https://rsshub.app/apnews/topics/apf-topnews',

      // New York Times
      'NYTimes World': 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
      'NYTimes US': 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',
      'NYTimes Tech': 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
      'NYTimes Business': 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',

      // Washington Post
      'Washington Post': 'https://feeds.washingtonpost.com/rss/world',

      // Wall Street Journal
      'WSJ': 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',
      'WSJ Tech': 'https://feeds.a.dj.com/rss/RSSWSJD.xml',

      // USA Today
      'USA Today': 'http://rssfeeds.usatoday.com/usatoday-NewsTopStories',

      // NPR
      'NPR': 'https://feeds.npr.org/1001/rss.xml',

      // The Guardian
      'The Guardian': 'https://www.theguardian.com/world/rss',
      'The Guardian Tech': 'https://www.theguardian.com/technology/rss',

      // Bloomberg
      'Bloomberg': 'https://www.bloomberg.com/feeds/sitemap_news.xml',

      // Forbes
      'Forbes': 'https://www.forbes.com/real-time/feed2/',

      // Time
      'Time': 'https://time.com/feed/',

      // Politico
      'Politico': 'https://www.politico.com/rss/politics08.xml',

      // ABC News
      'ABC News': 'https://abcnews.go.com/abcnews/topstories',

      // CBS News
      'CBS News': 'https://www.cbsnews.com/latest/rss/main',
    };
  }

  /**
   * Search news from multiple RSS feeds.
   * All feeds use flexible keyword matching (any query word).
   */
  async searchNews(query, maxPerFeed = 100, excludedSources = []) {
    const allArticles = [];

    const allFeeds = { ...this.KOREAN_FEEDS, ...this.INTL_FEEDS };

    const feedPromises = Object.entries(allFeeds).map(
      async ([sourceName, feedUrl]) => {
        if (excludedSources.includes(sourceName)) return [];
        try {
          return await this._fetchFeed(feedUrl, sourceName, query, maxPerFeed);
        } catch {
          return [];
        }
      }
    );

    const results = await Promise.allSettled(feedPromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        allArticles.push(...result.value);
      }
    }

    return allArticles;
  }

  /**
   * Fetch RSS feed with flexible keyword matching.
   * Splits query into words and matches if ANY word appears in title or description.
   */
  async _fetchFeed(feedUrl, sourceName, query, maxResults) {
    try {
      const feed = await this.parser.parseURL(feedUrl);
      const articles = [];
      const queryLower = query.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 2);
      // Also keep the full query for single-word or exact matching
      const matchers = queryWords.length > 0 ? queryWords : [queryLower];

      const entries = (feed.items || []).slice(0, maxResults * 3);

      for (const entry of entries) {
        const title = (entry.title || '').toLowerCase();
        const description = (entry.contentSnippet || entry.content || entry.summary || '').toLowerCase();
        const combined = title + ' ' + description;

        // Match if ANY query word appears
        const matches = matchers.some(word => combined.includes(word));
        if (!matches) continue;

        const article = this._parseEntry(entry, sourceName);
        if (article) articles.push(article);
        if (articles.length >= maxResults) break;
      }

      return articles;
    } catch {
      return [];
    }
  }

  _parseEntry(entry, sourceName) {
    try {
      const title = entry.title || '';
      const url = entry.link || '';
      if (!title || !url) return null;

      const articleId = generateNewsId(url, title);

      // Parse date
      const dateStr = entry.pubDate || entry.isoDate || '';
      const publishedAt = parsePublishedDate(dateStr, sourceName);

      // Get description and remove HTML tags
      let description = entry.contentSnippet || entry.content || entry.summary || '';
      if (description) {
        const $ = cheerio.load(description);
        description = $.text().trim().slice(0, 500);
      }

      // Extract thumbnail from RSS entry
      const thumbnail = this._extractThumbnail(entry);

      return {
        id: articleId,
        title,
        url,
        source: sourceName,
        publishedAt: publishedAt ? publishedAt.toISOString() : null,
        snippet: description || null,
        thumbnail,
      };
    } catch {
      return null;
    }
  }

  _extractThumbnail(entry) {
    try {
      // 1. media:thumbnail
      const mediaThumbnail = entry['media:thumbnail'];
      if (mediaThumbnail) {
        const item = Array.isArray(mediaThumbnail) ? mediaThumbnail[0] : mediaThumbnail;
        const url = item?.$ ?.url || item?.url;
        if (url) return url;
      }

      // 2. media:content (type이 image인 것)
      const mediaContent = entry['media:content'];
      if (mediaContent) {
        const items = Array.isArray(mediaContent) ? mediaContent : [mediaContent];
        for (const item of items) {
          const attrs = item?.$ || item;
          const medium = attrs?.medium;
          const type = attrs?.type || '';
          const url = attrs?.url;
          if (url && (medium === 'image' || type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)/i.test(url))) {
            return url;
          }
        }
        // media:content가 있지만 type 정보 없으면 첫 번째 URL 사용
        const firstUrl = (items[0]?.$ || items[0])?.url;
        if (firstUrl && /\.(jpg|jpeg|png|gif|webp)/i.test(firstUrl)) return firstUrl;
      }

      // 3. enclosure (type이 image인 것)
      const enclosure = entry.enclosure;
      if (enclosure) {
        const type = enclosure.type || '';
        const url = enclosure.url;
        if (url && (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)/i.test(url))) {
          return url;
        }
      }

      // 4. HTML content 안의 <img> 태그에서 추출
      const htmlContent = entry.content || entry['content:encoded'] || entry.description || '';
      if (htmlContent && htmlContent.includes('<img')) {
        const $ = cheerio.load(htmlContent);
        const imgSrc = $('img').first().attr('src');
        if (imgSrc && imgSrc.startsWith('http')) return imgSrc;
      }

      return null;
    } catch {
      return null;
    }
  }
}

module.exports = { RSSParserService };
