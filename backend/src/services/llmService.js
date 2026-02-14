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
}

function getLlmService() {
  const apiKey = process.env.Cerebras_API_KEY;
  if (!apiKey) {
    throw new Error('Cerebras_API_KEY environment variable is required');
  }
  return new CerebrasLLMService(apiKey);
}

module.exports = { CerebrasLLMService, getLlmService };
