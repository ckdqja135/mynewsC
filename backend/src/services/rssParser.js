const Parser = require('rss-parser');
const cheerio = require('cheerio');
const { generateNewsId } = require('../utils/idGenerator');
const { parsePublishedDate } = require('../utils/dateParser');

class RSSParserService {
  constructor() {
    this.parser = new Parser({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsCrawler/1.0)',
      },
    });

    // 주요 한국 뉴스 RSS 피드
    this.RSS_FEEDS = {
      // 한국 언론사
      '연합뉴스': 'https://www.yonhapnewstv.co.kr/category/news/headline/feed/',
      'KBS': 'https://news.kbs.co.kr/rss/headline.xml',
      'MBC': 'https://imnews.imbc.com/rss/news/news_00.xml',
      'SBS': 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01',
      'JTBC': 'https://fs.jtbc.co.kr/RSS/newsflash.xml',

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
   * Filters results by query keyword.
   */
  async searchNews(query, maxPerFeed = 50, excludedSources = []) {
    const allArticles = [];

    const feedPromises = Object.entries(this.RSS_FEEDS).map(
      async ([sourceName, feedUrl]) => {
        if (excludedSources.includes(sourceName)) {
          console.log(`[RSS] Skipping excluded source: ${sourceName}`);
          return [];
        }
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

  async _fetchFeed(feedUrl, sourceName, query, maxResults) {
    try {
      const feed = await this.parser.parseURL(feedUrl);
      const articles = [];
      const queryLower = query.toLowerCase();
      const entries = (feed.items || []).slice(0, maxResults * 2);

      for (const entry of entries) {
        const title = entry.title || '';
        const description = entry.contentSnippet || entry.content || entry.summary || '';

        if (
          !title.toLowerCase().includes(queryLower) &&
          !description.toLowerCase().includes(queryLower)
        ) {
          continue;
        }

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
        // Remove HTML tags using cheerio
        const $ = cheerio.load(description);
        description = $.text().trim().slice(0, 500);
      }

      return {
        id: articleId,
        title,
        url,
        source: sourceName,
        publishedAt: publishedAt ? publishedAt.toISOString() : null,
        snippet: description || null,
        thumbnail: null,
      };
    } catch {
      return null;
    }
  }
}

module.exports = { RSSParserService };
