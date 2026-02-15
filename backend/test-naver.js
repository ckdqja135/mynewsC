const axios = require('axios');
const cheerio = require('cheerio');

async function testNaver() {
  try {
    const response = await axios.get('https://search.naver.com/search.naver', {
      params: {
        where: 'news',
        query: '삼성',
        start: 1,
        sort: 1
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);

    console.log('=== Finding News Items ===\n');

    // Try to find news items - they seem to be in certain data structures
    const selectors = [
      '.fds-news-item',
      '[data-template-type="news-item"]',
      '.sds-comps-news-item',
      '.api_subject_bx [class*="news-item"]',
      '.api_subject_bx .sds-comps-vertical-layout'
    ];

    selectors.forEach(sel => {
      console.log(`${sel}: ${$(sel).length}`);
    });

    console.log('\n=== Analyzing Structure ===');

    // Find all items that have both a link and text content
    const newsItems = [];
    $('.api_subject_bx').find('a[href*="/article/"]').each((i, linkEl) => {
      const $link = $(linkEl);
      const href = $link.attr('href');

      // Try to find title - could be in the link itself or nearby
      const directText = $link.clone().children().remove().end().text().trim();

      if (directText && directText.length > 15 && directText.length < 200) {
        newsItems.push({
          title: directText,
          url: href
        });
      }
    });

    // Deduplicate by URL
    const uniqueItems = [];
    const seenUrls = new Set();
    newsItems.forEach(item => {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        uniqueItems.push(item);
      }
    });

    console.log(`\nFound ${uniqueItems.length} unique news items:\n`);
    uniqueItems.slice(0, 10).forEach((item, i) => {
      console.log(`${i + 1}. ${item.title}`);
      console.log(`   URL: ${item.url}\n`);
    });

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

testNaver();
