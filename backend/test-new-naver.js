const { NaverNewsService } = require('./src/services/naverNews.js');

async function test() {
  const naver = new NaverNewsService();

  console.log('Testing Naver News Crawler...\n');

  try {
    const articles = await naver.searchNews('삼성', 20);

    console.log(`Found: ${articles.length} articles\n`);

    articles.slice(0, 10).forEach((a, i) => {
      console.log(`${i + 1}. ${a.title}`);
      console.log(`   Source: ${a.source}`);
      console.log(`   Date: ${a.publishedAt}`);
      console.log(`   URL: ${a.url}\n`);
    });

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

test();
