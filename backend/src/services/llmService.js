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
   * 개별 기사의 감성 분석 (검색어 기준)
   * @param {string} title - 기사 제목
   * @param {string} query - 검색 키워드
   * @returns {Promise<string>} 'positive', 'negative', 또는 'neutral'
   */
  async classifyArticleSentiment(title, query) {
    const prompt = `기사 제목: "${title}"
검색 키워드: "${query}"

이 기사가 "${query}" 자체에 대해 어떤 감성을 나타내는지 분류하세요.

**중요**: 회사의 주가, 재무, 실적 문제는 제품/콘텐츠 자체의 문제가 아닙니다.
- 예시: "티니핑" 검색 시 → "SAMG엔터 주가 하락" = neutral (회사 문제 ≠ 티니핑 문제)
- 예시: "티니핑" 검색 시 → "티니핑 흥행" = positive (티니핑 자체의 성공)
- 예시: "티니핑" 검색 시 → "티니핑 논란" = negative (티니핑 자체의 문제)

**positive (긍정)**: ${query} 자체에 대한 좋은 소식이나 성과
 예시: 호재, 급등, 급동, 흥행, 대박, 호실적, 호평, 성공, 성장, 인기, 완판, 매진, 수상, 1위

**negative (부정)**: ${query} 자체에 대한 문제나 비판
 예시: 논란, 비판, 실패, 사고, 문제, 리콜, 적발, 표절, 하자, 오류

**neutral (중립)**: 단순 사실 전달이거나, ${query}와 관련된 회사/인물의 재무/주가 문제

응답은 반드시 positive, negative, neutral 중 정확히 하나만 출력하세요.`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a sentiment analysis expert. Respond with only one word: positive, negative, or neutral.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 10,
      });

      const result = response.choices[0].message.content.trim().toLowerCase();

      // 결과 검증
      if (result.includes('positive')) return 'positive';
      if (result.includes('negative')) return 'negative';
      if (result.includes('neutral')) return 'neutral';

      // 기본값
      return 'neutral';
    } catch (error) {
      console.error(`[LLM] Sentiment analysis failed: ${error.message}`);
      return 'neutral';
    }
  }

  /**
   * 여러 기사의 감성 분석 (병렬 처리)
   * @param {Array} articles - 기사 배열
   * @param {string} query - 검색 키워드
   * @returns {Promise<Array>} 감성이 태그된 기사 배열
   */
  async analyzeSentimentBatch(articles, query) {
    console.log(`[LLM] Analyzing sentiment for ${articles.length} articles...`);

    // 병렬 처리로 성능 향상
    const sentimentPromises = articles.map(async (article) => {
      const sentiment = await this.classifyArticleSentiment(article.title, query);
      return {
        ...article,
        sentiment,
      };
    });

    const results = await Promise.all(sentimentPromises);
    console.log(`[LLM] Sentiment analysis completed`);
    return results;
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
