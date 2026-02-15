const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function analyze() {
  try {
    const response = await axios.get('https://search.naver.com/search.naver', {
      params: {
        where: 'news',
        query: '삼성',
        start: 1,
        sort: 1
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    fs.writeFileSync('naver.html', response.data);
    const $ = cheerio.load(response.data);

    // Save just a portion for analysis
    const mainContent = $('#main_pack').html() || '';
    fs.writeFileSync('naver-main.html', mainContent);

    console.log('=== Checking various title selectors ===');
    const titleSels = [
      'h2, h3, h4',
      '.title',
      '.headline',
      '[class*="title"]',
      '[class*="headline"]',
      '[data-type="title"]',
      '.sds-comps-news-item-title',
      '.fds-news-item-title'
    ];

    titleSels.forEach(sel => {
      const count = $(sel).length;
      if (count > 0) {
        console.log(`${sel}: ${count}`);
        $(sel).slice(0, 2).each((i, el) => {
          console.log(`  ${i + 1}. ${$(el).text().trim().substring(0, 60)}`);
        });
      }
    });

  } catch (error) {
    console.error('Error:', error.message);
  }
}

analyze();
