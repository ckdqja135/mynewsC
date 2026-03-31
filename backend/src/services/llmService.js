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

  /**
   * RAG 청크 기반 컨텍스트 생성 (URL 포함, 인용 강제)
   * @param {Array} chunks - rankChunksBySimilarity 결과 [{text, article, score, ...}]
   * @returns {string}
   */
  _prepareChunksContext(chunks) {
    return chunks.map((chunk, idx) => {
      const article = chunk.article;
      const dateStr = article.publishedAt
        ? new Date(article.publishedAt).toISOString().split('T')[0]
        : '날짜 미상';
      const urlPart = article.url ? ` | URL: ${article.url}` : '';

      const text = chunk.text.length > 300 ? chunk.text.slice(0, 300) + '...' : chunk.text;
      return `[참고 ${idx + 1}]
제목: ${article.title}
출처: ${article.source} | 날짜: ${dateStr}${urlPart}
내용: ${text}`;
    }).join('\n\n---\n\n');
  }

  /**
   * 청크 배열의 평균 유사도로 신뢰도 점수 계산 (0~1)
   */
  _calcConfidence(chunks) {
    if (!chunks || chunks.length === 0) return null;
    const scores = chunks.map(c => c.score || 0).filter(s => s > 0);
    if (scores.length === 0) return null;
    return Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100;
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

  async analyzeComprehensive(query, articles, chunks = null) {
    const context = chunks && chunks.length > 0
      ? this._prepareChunksContext(chunks)
      : this._prepareArticlesContext(articles);

    const dates = articles
      .filter(a => a.publishedAt)
      .map(a => new Date(a.publishedAt));

    let dateRange = '';
    if (dates.length > 0) {
      const earliest = new Date(Math.min(...dates)).toISOString().split('T')[0];
      const latest = new Date(Math.max(...dates)).toISOString().split('T')[0];
      dateRange = ` (Articles from ${earliest} to ${latest})`;
    }

    const citationNote = chunks && chunks.length > 0
      ? '\n\n중요: 각 주장에 반드시 [참고 1], [참고 2] 형태로 출처를 명시하세요. 참고자료에 없는 내용은 작성하지 마세요.'
      : '';

    const prompt = `You are a professional news analyst. Analyze the following news articles about "${query}"${dateRange} and provide a comprehensive analysis.

${context}${citationNote}

IMPORTANT: Respond in Korean (한국어로 응답해주세요). All text fields should be in Korean.

When analyzing sentiment:
- **Positive aspects**: Good news, achievements, growth indicators (호재, 급등, 흥행, 호실적, 성공, 성장, 상승, 수상, 인기 등)
- **Negative aspects**: Problems, criticism, negative indicators (논란, 비판, 하락, 급락, 실패, 사고, 문제, 손실 등)

Please provide a detailed analysis in the following JSON format:
{
    "summary": "A concise 2-3 sentence summary of what's happening with ${query}",
    "key_points": ["Key point 1 [참고 N]", "Key point 2 [참고 N]", ...],
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

    const confidence_score = this._calcConfidence(chunks);
    const sources = chunks
      ? chunks.map(c => ({ title: c.article.title, url: c.article.url, score: c.score }))
      : null;

    try {
      const result = this._parseJsonResponse(resultText);
      return {
        query,
        analysis_type: 'comprehensive',
        articles_analyzed: articles.length,
        confidence_score,
        sources,
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
        confidence_score,
        sources,
        summary: resultText.slice(0, 500),
        key_points: ['Analysis completed but format error occurred'],
        sentiment: null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    }
  }

  async analyzeSentiment(query, articles, chunks = null) {
    const context = chunks && chunks.length > 0
      ? this._prepareChunksContext(chunks)
      : this._prepareArticlesContext(articles);

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

    const confidence_score = this._calcConfidence(chunks);
    const sources = chunks
      ? chunks.map(c => ({ title: c.article.title, url: c.article.url, score: c.score }))
      : null;

    try {
      const result = this._parseJsonResponse(resultText);
      return {
        query,
        analysis_type: 'sentiment',
        articles_analyzed: articles.length,
        confidence_score,
        sources,
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
        confidence_score,
        sources,
        summary: resultText.slice(0, 500),
        key_points: ['Sentiment analysis completed'],
        sentiment: null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    }
  }

  async analyzeTrends(query, articles, chunks = null) {
    const context = chunks && chunks.length > 0
      ? this._prepareChunksContext(chunks)
      : this._prepareArticlesContext(articles);

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

    const confidence_score = this._calcConfidence(chunks);
    const sources = chunks
      ? chunks.map(c => ({ title: c.article.title, url: c.article.url, score: c.score }))
      : null;

    try {
      const result = this._parseJsonResponse(resultText);
      return {
        query,
        analysis_type: 'trend',
        articles_analyzed: articles.length,
        confidence_score,
        sources,
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
        confidence_score,
        sources,
        summary: resultText.slice(0, 500),
        key_points: ['Trend analysis completed'],
        sentiment: null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    }
  }

  async extractKeyPoints(query, articles, chunks = null) {
    const context = chunks && chunks.length > 0
      ? this._prepareChunksContext(chunks)
      : this._prepareArticlesContext(articles);

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

    const confidence_score = this._calcConfidence(chunks);
    const sources = chunks
      ? chunks.map(c => ({ title: c.article.title, url: c.article.url, score: c.score }))
      : null;

    try {
      const result = this._parseJsonResponse(resultText);
      return {
        query,
        analysis_type: 'key_points',
        articles_analyzed: articles.length,
        confidence_score,
        sources,
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
        confidence_score,
        sources,
        summary: resultText.slice(0, 500),
        key_points: ['Key points extracted'],
        sentiment: null,
        trends: null,
        generated_at: new Date().toISOString(),
      };
    }
  }

  /**
   * 스니펫이 없는 기사들의 제목으로 짧은 요약 생성 (LLM 스니펫 fallback)
   * @param {Array} articles - [{title, source, ...}]
   * @returns {Promise<string[]>} 각 기사의 2문장 요약 (실패 시 null)
   */
  async generateSnippets(articles) {
    if (!articles || articles.length === 0) return [];

    const titlesText = articles.map((a, i) =>
      `${i + 1}. [${a.source || '미상'}] ${a.title}`
    ).join('\n');

    const prompt = `아래 뉴스 기사 제목들을 보고, 각각 2문장 이내의 간결한 한국어 요약을 생성하세요.
제목에 있는 정보만 활용하고, 추측은 최소화하세요.

${titlesText}

각 줄에 번호와 요약을 출력하세요 (예: "1. 요약 내용"):`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: '뉴스 제목을 보고 2문장 이내 요약을 생성하는 어시스턴트입니다. 번호와 요약만 출력하세요.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: articles.length * 60,
      });

      const text = response.choices[0].message.content.trim();
      const results = articles.map(() => null);

      for (const line of text.split('\n')) {
        const match = line.match(/^(\d+)\.\s*(.+)/);
        if (match) {
          const idx = parseInt(match[1]) - 1;
          if (idx >= 0 && idx < articles.length) results[idx] = match[2].trim();
        }
      }
      return results;
    } catch (err) {
      console.warn(`[LLM] generateSnippets failed: ${err.message}`);
      return articles.map(() => null);
    }
  }

  /**
   * 기사들의 쿼리 관련도를 LLM으로 리랭킹
   * @param {Array} articles - 기사 배열 ({title, snippet, ...})
   * @param {string} query - 검색 쿼리
   * @param {number} batchSize - 배치 크기
   * @returns {Promise<Array<{article, relevance_score}>>} 관련도 점수가 포함된 배열
   */
  async rerankArticles(articles, query, batchSize = 10) {
    const results = [];

    console.log(`[LLM Rerank] Reranking ${articles.length} articles for query: "${query}" (${Math.ceil(articles.length / batchSize)} batches)`);

    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const batchScores = await this._rerankBatch(batch, query);

      batch.forEach((article, j) => {
        results.push({ article, relevance_score: batchScores[j] });
      });

      console.log(`[LLM Rerank] Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(articles.length / batchSize)} done`);
    }

    console.log(`[LLM Rerank] Completed. Score distribution: ${JSON.stringify(this._scoreDistribution(results))}`);
    return results;
  }

  _scoreDistribution(results) {
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    results.forEach(r => { dist[r.relevance_score] = (dist[r.relevance_score] || 0) + 1; });
    return dist;
  }

  async _rerankBatch(articles, query) {
    const articlesText = articles.map((a, i) => {
      const snippet = a.snippet ? ` | 내용: ${a.snippet.slice(0, 150)}` : '';
      return `${i + 1}. 제목: "${a.title}"${snippet}`;
    }).join('\n');

    const prompt = `사용자가 "${query}"에 대해 검색했습니다.
아래 기사들이 이 검색 주제에 실제로 관한 기사인지 판단하고, 관련도 점수를 매겨주세요.

판단 기준:
- 5점: 검색 주제가 기사의 핵심 주제 (제목과 내용이 모두 해당 주제에 대한 것)
- 4점: 검색 주제가 기사의 주요 내용 중 하나
- 3점: 검색 주제와 관련은 있으나 핵심 주제는 아님
- 2점: 검색 주제가 본문에 언급만 되었을 뿐, 기사의 주제는 다름
- 1점: 검색 주제와 거의 무관하거나, 의미 없는 기사 (예: "동영상 첨부된 문서")

기사 목록:
${articlesText}

각 줄에 번호와 점수만 출력하세요 (예: "1. 5"):`;

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a relevance scoring assistant. Score each article\'s relevance to the search query. Respond with number and score (1-5) per line only.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: articles.length * 10,
        });

        const text = response.choices[0].message.content.trim();
        const scores = articles.map(() => 3); // default: 중간

        for (const line of text.split('\n')) {
          const match = line.match(/(\d+)\D*(\d)/);
          if (match) {
            const idx = parseInt(match[1]) - 1;
            const score = Math.min(5, Math.max(1, parseInt(match[2])));
            if (idx >= 0 && idx < articles.length) {
              scores[idx] = score;
            }
          }
        }

        return scores;
      } catch (error) {
        const isRetryable = attempt < MAX_RETRIES - 1 && (
          error.status === 429 || (error.message && error.message.includes('429')) ||
          (error.status >= 500 && error.status < 600)
        );
        if (isRetryable) {
          const delay = 1000 * (attempt + 1);
          console.warn(`[LLM Rerank] API error [${error.status || '?'}], retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`[LLM Rerank] Batch rerank failed [${error.status || '?'}]: ${error.message}`);
        return articles.map(() => 3); // 실패 시 중간값으로 fallback
      }
    }
    return articles.map(() => 3);
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
        const isRetryable = attempt < MAX_RETRIES - 1 && (
          error.status === 429 || (error.message && error.message.includes('429')) ||
          (error.status >= 500 && error.status < 600)
        );
        if (isRetryable) {
          const delay = 1000 * (attempt + 1);
          console.warn(`[LLM] API error [${error.status || '?'}], retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`[LLM] Batch sentiment failed [${error.status || '?'}]: ${error.message}`);
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
