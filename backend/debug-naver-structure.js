const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function debug() {
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

  const $ = cheerio.load(response.data);

  console.log('=== First Headline Container Analysis ===\n');

  const $firstHeadline = $('[class*="headline"]').first();
  const $container = $firstHeadline.closest('[class*="news"], .api_subject_bx, [class*="item"]');

  console.log('Headline text:', $firstHeadline.text());
  console.log('\nContainer classes:', $container.attr('class'));
  console.log('\nContainer HTML (first 500 chars):');
  console.log($container.html().substring(0, 500));

  console.log('\n=== Looking for Press/Source ===');
  console.log('All links in container:');
  $container.find('a').each((i, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (text && text.length < 50) {
      console.log(`${i + 1}. "${text}" -> ${href.substring(0, 80)}`);
    }
  });

  console.log('\n=== Looking for Time/Date ===');
  console.log('All text nodes with time-related content:');
  $container.find('*').each((i, el) => {
    const text = $(el).clone().children().remove().end().text().trim();
    if (text && (/전|분|시간|일|\d{4}\.\d/.test(text)) && text.length < 50) {
      const className = $(el).attr('class') || '';
      console.log(`- "${text}" (class: ${className})`);
    }
  });

  // Save full HTML of first article for inspection
  fs.writeFileSync('first-article.html', $container.html());
  console.log('\n✓ First article HTML saved to first-article.html');
}

debug().catch(console.error);
