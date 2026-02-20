const OpenAI = require('openai');

class CerebrasLLMService {
  constructor(apiKey) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.cerebras.ai/v1',
    });
    // Cerebras models: llama3.1-8b, llama3.3-70b
    this.model = 'llama3.1-8b';
  }

  _prepareArticlesContext(articles, maxArticles = 20) {
    return articles.slice(0, maxArticles).map((article, idx) => {
      let snippet = article.snippet || 'No content available';
      if (snippet.length > 150) snippet = snippet.slice(0, 150) + '...';

      const dateStr = article.publishedAt
        ? new Date(article.publishedAt).toISOString().split('T')[0]
        : 'Unknown';

      return `[Article ${idx + 1}]
Title: ${article.title}
Source: ${article.source}
Date: ${dateStr}
Content: ${snippet}`;
    }).join('\n\n');
  }

  _parseJsonResponse(text) {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.split('```')[1];
      if (cleaned.startsWith('json')) cleaned = cleaned.slice(4);
      cleaned = cleaned.trim();
    }
    return JSON.parse(cleaned);
  }

  async analyzeComprehensive(query, articles) {
    const context = this._prepareArticlesContext(articles);

    const dates = articles
      .filter(a => a.publishedAt)
      .map(a => new Date(a.publishedAt));

    let dateRange = '';
    if (dates.length > 0) {
      const earliest = new Date(Math.min(...dates)).toISOString().split('T')[0];
      const latest = new Date(Math.max(...dates)).toISOString().split('T')[0];
      dateRange = ` (Articles from ${earliest} to ${latest})`;
    }

    const prompt = `You are a professional news analyst. Analyze the following news articles about "${query}"${dateRange} and provide a comprehensive analysis.

${context}

IMPORTANT: Respond in Korean (한국어로 응답해주세요). All text fields should be in Korean.

When analyzing sentiment:
- **Positive aspects**: Good news, achievements, growth indicators (호재, 급등, 흥행, 호실적, 성공, 성장, 상승, 수상, 인기 등)
- **Negative aspects**: Problems, criticism, negative indicators (논란, 비판, 하락, 급락, 실패, 사고, 문제, 손실 등)

Please provide a detailed analysis in the following JSON format:
{
    "summary": "A concise 2-3 sentence summary of what's happening with ${query}",
    "key_points": ["Key point 1", "Key point 2", "Key point 3", ...],
    "sentiment": {
        "overall_sentiment": "positive/negative/neutral",
        "sentiment_score": 0.0,
        "positive_aspects": ["aspect 1", "aspect 2", ...],
        "negative_aspects": ["aspect 1", "aspect 2", ...]
    },
    "trends": {
        "main_topics": ["topic 1", "topic 2", ...],
        "emerging_trends": ["trend 1", "trend 2", ...],
        "key_entities": ["entity 1", "entity 2", ...]
    }
}

Respond ONLY with valid JSON. No additional text.`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: 'You are a professional news analyst. Always respond in Korean (한국어) and in valid JSON format only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const resultText = response.choices[0].message.content.trim();

    try {
      const result = this._parseJsonResponse(resultText);
      return {
        query,
        analysis_type: 'comprehensive',
        articles_analyzed: articles.length,
        summary: result.summary || '',
        key_points: result.key_points || [],
        sentiment: result.sentiment || null,
        trends: result.trends || null,
        generated_at: new Date().toISOString(),
      };
    } catch {
      return {
        query,
        analysis_type: 'comprehensive',
        articles_analyzed: articles.length,
        summary: resultText.slice(0, 500),
        key_points: ['Analysis completed but format error occurred'],
        sentiment: null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    }
  }

  async analyzeSentiment(query, articles) {
    const context = this._prepareArticlesContext(articles);

    const prompt = `You are a professional sentiment analyst. Analyze the sentiment in news articles about "${query}".

${context}

IMPORTANT: Respond in Korean (한국어로 응답해주세요). All text fields should be in Korean.

When analyzing sentiment, clearly distinguish:
- **Positive aspects**: Good news, achievements, growth (호재, 급등, 급동, 흥행, 호실적, 대박, 성공, 성장, 상승, 수상, 호평, 인기, 완판 등)
- **Negative aspects**: Problems, criticism, decline (논란, 비판, 하락, 급락, 실패, 사고, 문제, 리콜, 손실, 적자, 폐업 등)

Provide a sentiment analysis in the following JSON format:
{
    "summary": "Brief summary of overall sentiment",
    "key_points": ["Key sentiment insight 1", "Key sentiment insight 2", ...],
    "sentiment": {
        "overall_sentiment": "positive/negative/neutral",
        "sentiment_score": 0.0,
        "positive_aspects": ["positive aspect 1", "positive aspect 2", ...],
        "negative_aspects": ["negative aspect 1", "negative aspect 2", ...]
    }
}

Sentiment score should be from -1.0 (very negative) to 1.0 (very positive).
Respond ONLY with valid JSON.`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: 'You are a professional sentiment analyst. Always respond in Korean (한국어) and in valid JSON format only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const resultText = response.choices[0].message.content.trim();

    try {
      const result = this._parseJsonResponse(resultText);
      return {
        query,
        analysis_type: 'sentiment',
        articles_analyzed: articles.length,
        summary: result.summary || '',
        key_points: result.key_points || [],
        sentiment: result.sentiment || null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    } catch {
      return {
        query,
        analysis_type: 'sentiment',
        articles_analyzed: articles.length,
        summary: resultText.slice(0, 500),
        key_points: ['Sentiment analysis completed'],
        sentiment: null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    }
  }

  async analyzeTrends(query, articles) {
    const context = this._prepareArticlesContext(articles);

    const prompt = `You are a professional trend analyst. Identify trends and patterns in news articles about "${query}".

${context}

IMPORTANT: Respond in Korean (한국어로 응답해주세요). All text fields should be in Korean.

Provide a trend analysis in the following JSON format:
{
    "summary": "Brief summary of main trends",
    "key_points": ["Key trend 1", "Key trend 2", ...],
    "trends": {
        "main_topics": ["topic 1", "topic 2", ...],
        "emerging_trends": ["emerging trend 1", "emerging trend 2", ...],
        "key_entities": ["person/org 1", "person/org 2", ...]
    }
}

Respond ONLY with valid JSON.`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: 'You are a professional trend analyst. Always respond in Korean (한국어) and in valid JSON format only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const resultText = response.choices[0].message.content.trim();

    try {
      const result = this._parseJsonResponse(resultText);
      return {
        query,
        analysis_type: 'trend',
        articles_analyzed: articles.length,
        summary: result.summary || '',
        key_points: result.key_points || [],
        sentiment: null,
        trends: result.trends || null,
        generated_at: new Date().toISOString(),
      };
    } catch {
      return {
        query,
        analysis_type: 'trend',
        articles_analyzed: articles.length,
        summary: resultText.slice(0, 500),
        key_points: ['Trend analysis completed'],
        sentiment: null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    }
  }

  async extractKeyPoints(query, articles) {
    const context = this._prepareArticlesContext(articles);

    const prompt = `You are a professional news summarizer. Extract the most important key points from news articles about "${query}".

${context}

IMPORTANT: Respond in Korean (한국어로 응답해주세요). All text fields should be in Korean.

Provide key points in the following JSON format:
{
    "summary": "One sentence summary of the most important information",
    "key_points": ["Key point 1", "Key point 2", "Key point 3", ...]
}

Focus on factual, actionable information. Respond ONLY with valid JSON.`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: 'You are a professional news summarizer. Always respond in Korean (한국어) and in valid JSON format only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

    const resultText = response.choices[0].message.content.trim();

    try {
      const result = this._parseJsonResponse(resultText);
      return {
        query,
        analysis_type: 'key_points',
        articles_analyzed: articles.length,
        summary: result.summary || '',
        key_points: result.key_points || [],
        sentiment: null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    } catch {
      return {
        query,
        analysis_type: 'key_points',
        articles_analyzed: articles.length,
        summary: resultText.slice(0, 500),
        key_points: ['Key points extracted'],
        sentiment: null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    }
  }

  /**
   * 여러 제목을 한 번의 LLM 호출로 감성 분류 (배치 프롬프트)
   * @param {string[]} titles - 기사 제목 배열
   * @param {string} query - 검색 키워드
   * @returns {Promise<string[]>} 감성 배열 ('positive'|'negative'|'neutral')
   */
  async classifyArticlesBatch(articles, query) {
    const articlesText = articles.map((a, i) => {
      const snippet = a.snippet ? ` | 내용: ${a.snippet.slice(0, 150)}` : '';
      return `${i + 1}. 제목: "${a.title}"${snippet}`;
    }).join('\n');

    const prompt = `각 기사의 제목과 내용을 보고 감성을 분류하세요.
개별 단어가 아닌, 기사 전체가 전달하는 메시지를 판단하세요.

분류 기준:
- positive: 좋은 소식 (흥행, 성과, 수상, 성장, 이익 증가 등)
- negative: 나쁜 소식 (손실, 적자, 논란, 실패, 비판, 수익 문제 등)
- neutral: 단순 사실 전달, 투자자 동향, 판단이 어려운 경우

예시:
- "A 대박 B사, 팔아도 남는 게 없는 이유" → negative (전체 의미는 수익 문제)
- "A 흥행 덕에 B사 매출 급증" → positive
- "A사 주요 투자자, 일부 지분 매도" → neutral

기사 목록:
${articlesText}

각 줄에 번호와 positive/negative/neutral만 출력하세요:`;

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a Korean news sentiment classifier. Classify each article based on its title AND content snippet. Focus on the OVERALL meaning, not individual words. Respond with number and one word per line.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: articles.length * 15,
        });

        const text = response.choices[0].message.content.trim().toLowerCase();
        console.log(`[LLM] Raw response:\n${text}`);
        const results = articles.map(() => 'neutral');

        let parsed = 0;
        for (const line of text.split('\n')) {
          const match = line.match(/(\d+)\D*(positive|negative|neutral)/);
          if (match) {
            const idx = parseInt(match[1]) - 1;
            if (idx >= 0 && idx < articles.length) {
              results[idx] = match[2];
              parsed++;
            }
          }
        }

        const counts = { positive: 0, negative: 0, neutral: 0 };
        results.forEach(r => counts[r]++);
        console.log(`[LLM] Parsed ${parsed}/${articles.length} - positive: ${counts.positive}, negative: ${counts.negative}, neutral: ${counts.neutral}`);

        return results;
      } catch (error) {
        if (error.message && error.message.includes('429') && attempt < MAX_RETRIES - 1) {
          const delay = 1000 * (attempt + 1);
          console.warn(`[LLM] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`[LLM] Batch sentiment failed: ${error.message}`);
        return articles.map(() => 'neutral');
      }
    }
    return articles.map(() => 'neutral');
  }

  /**
   * 여러 기사의 감성 분석 (배치 프롬프트, 상위 N개만 LLM)
   * @param {Array} articles - 기사 배열 (similarity_score 내림차순 권장)
   * @param {string} query - 검색 키워드
   * @returns {Promise<Array>} 감성이 태그된 기사 배열
   */
  async analyzeSentimentBatch(articles, query) {
    const LLM_CLASSIFY_LIMIT = 200;
    const BATCH_SIZE = 10;

    const toClassify = articles.slice(0, LLM_CLASSIFY_LIMIT);
    const rest = articles.slice(LLM_CLASSIFY_LIMIT);

    console.log(`[LLM] Analyzing sentiment: ${toClassify.length} via LLM (${Math.ceil(toClassify.length / BATCH_SIZE)} API calls), ${rest.length} as neutral`);

    const classifiedResults = [];

    for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
      const batch = toClassify.slice(i, i + BATCH_SIZE);

      const sentiments = await this.classifyArticlesBatch(batch, query);

      batch.forEach((article, j) => {
        classifiedResults.push({ ...article, sentiment: sentiments[j] });
      });

      console.log(`[LLM] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toClassify.length / BATCH_SIZE)} done (${classifiedResults.length}/${toClassify.length})`);
    }

    const neutralResults = rest.map(article => ({ ...article, sentiment: 'neutral' }));

    console.log(`[LLM] Sentiment analysis completed`);
    return [...classifiedResults, ...neutralResults];
  }
}

function getLlmService() {
  const apiKey = process.env.Cerebras_API_KEY;
  if (!apiKey) {
    throw new Error('Cerebras_API_KEY environment variable is required');
  }
  return new CerebrasLLMService(apiKey);
}

module.exports = { CerebrasLLMService, getLlmService };
