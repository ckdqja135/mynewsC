const OpenAI = require('openai');

class CerebrasLLMService {
  constructor(apiKey) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.cerebras.ai/v1',
      // Cerebras 무료 티어는 분당 요청/토큰 한도가 빡빡해 429가 잦음.
      // SDK가 429/5xx를 지수 백오프로 자동 재시도하도록 재시도 횟수를 늘림.
      maxRetries: 4,
    });
    // Cerebras 무료 티어 현행 모델: zai-glm-4.7, gpt-oss-120b
    // 모델이 폐기되면 코드 수정 없이 .env의 CEREBRAS_MODEL 값만 바꾸면 됨
    this.model = process.env.CEREBRAS_MODEL || 'zai-glm-4.7';
    // 추론(reasoning) 모델(GLM/gpt-oss)은 감성 분류·랭킹 같은 구조적 작업에 추론이 불필요.
    // 추론을 끄면 토큰/속도가 크게 절약되고, 추론에 토큰을 다 써서 답(content)이 비는 문제도 방지됨.
    // 비추론 모델(gemma 등)로 바꿔 파라미터가 거부되면 .env에 CEREBRAS_REASONING_EFFORT= (빈값) 설정.
    this.reasoningEffort = process.env.CEREBRAS_REASONING_EFFORT ?? 'none';
  }

  // reasoning_effort 파라미터 (빈 문자열이면 파라미터 자체를 생략)
  _reasoningParam() {
    return this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {};
  }

  // LLM 응답에서 content를 안전하게 추출. 비어 있으면(추론 잘림/오류) 명확히 throw.
  _extractContent(response, label = 'LLM') {
    const choice = response && response.choices && response.choices[0];
    const content = choice && choice.message && choice.message.content;
    if (!content || !content.trim()) {
      const finish = (choice && choice.finish_reason) || 'unknown';
      throw new Error(`빈 LLM 응답 [${label}] (finish_reason: ${finish}). 추론 모델이면 max_tokens 부족 또는 CEREBRAS_REASONING_EFFORT 확인.`);
    }
    return content;
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
   * 청크를 기사 단위로 묶는다. contextChunks는 유사도 내림차순이므로,
   * 기사 최초 등장 순서(=최고 점수 순)를 보존해 [참고 N]과 sources[N-1] 순서를 일치시킨다.
   * @param {Array} chunks - rankChunksBySimilarity 결과 [{text, article, score, ...}]
   * @returns {Array<{article, chunks, score}>}
   */
  _groupChunksByArticle(chunks) {
    const map = new Map();
    const order = [];
    for (const c of (chunks || [])) {
      const a = c.article || {};
      const key = a.url || a.id || a.title || `#${order.length}`;
      if (!map.has(key)) {
        map.set(key, { article: a, chunks: [c], score: c.score || 0 });
        order.push(key);
      } else {
        const g = map.get(key);
        g.chunks.push(c);
        g.score = Math.max(g.score, c.score || 0);
      }
    }
    return order.map(k => map.get(k));
  }

  /**
   * RAG 청크 기반 컨텍스트 생성 (URL 포함, 인용 강제).
   * [참고 N] = 기사 N (기사 단위로 묶어 번호를 부여 → 인용을 실제 기사와 매핑 가능).
   * @param {Array} chunks
   * @returns {string}
   */
  _prepareChunksContext(chunks) {
    const groups = this._groupChunksByArticle(chunks);
    return groups.map((g, idx) => {
      const a = g.article;
      const dateStr = a.publishedAt
        ? new Date(a.publishedAt).toISOString().split('T')[0]
        : '날짜 미상';
      const urlPart = a.url ? ` | URL: ${a.url}` : '';
      let text = g.chunks.map(c => c.text).join(' … ');
      if (text.length > 500) text = text.slice(0, 500) + '...';
      return `[참고 ${idx + 1}]
제목: ${a.title}
출처: ${a.source || '출처 미상'} | 날짜: ${dateStr}${urlPart}
내용: ${text}`;
    }).join('\n\n---\n\n');
  }

  /**
   * 분석 결과의 근거 기사 목록을 기사 단위로 구성 (중복 제거, 언론사·발행시각 포함).
   * _prepareChunksContext와 동일한 순서라 [참고 N] ↔ sources[N-1]로 매핑된다.
   * @param {Array} chunks
   * @returns {Array|null}
   */
  // 스크래핑으로 붙는 '새 창 열림' 등 잔여 텍스트 제거
  _cleanText(t) {
    return String(t || '').replace(/\s*새\s*창\s*열림\s*$/g, '').trim();
  }

  // 언론사명이 오염(예: '새 창 열림')됐거나 이상하면 null로 (프론트에서 도메인으로 폴백)
  _cleanPress(s) {
    const p = this._cleanText(s);
    if (!p || /새\s*창\s*열림|^https?:/i.test(p) || p.length > 20) return null;
    return p;
  }

  _buildSources(chunks) {
    if (!chunks || chunks.length === 0) return null;
    const groups = this._groupChunksByArticle(chunks);
    return groups.map(g => ({
      title: this._cleanText(g.article.title),
      url: g.article.url,
      press: this._cleanPress(g.article.source),
      publishedAt: g.article.publishedAt || null,
      score: g.score,
      usedChunks: g.chunks.length,
    }));
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
      ...this._reasoningParam(),
    });

    const resultText = this._extractContent(response, 'analyze').trim();

    const confidence_score = this._calcConfidence(chunks);
    const sources = this._buildSources(chunks);

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
      ...this._reasoningParam(),
    });

    const resultText = this._extractContent(response, 'analyze').trim();

    const confidence_score = this._calcConfidence(chunks);
    const sources = this._buildSources(chunks);

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
      ...this._reasoningParam(),
    });

    const resultText = this._extractContent(response, 'analyze').trim();

    const confidence_score = this._calcConfidence(chunks);
    const sources = this._buildSources(chunks);

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
      ...this._reasoningParam(),
    });

    const resultText = this._extractContent(response, 'analyze').trim();

    const confidence_score = this._calcConfidence(chunks);
    const sources = this._buildSources(chunks);

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
          ...this._reasoningParam(),
        });

        const text = this._extractContent(response, 'rerank').trim();
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
        if (error.status === 404 || (error.message && error.message.includes('404'))) {
          console.error(`[LLM Rerank] ⚠️ 모델 '${this.model}'을(를) Cerebras가 인식하지 못함(404) → CEREBRAS_MODEL 확인 필요. 중간값(3)으로 폴백합니다.`);
        } else {
          console.error(`[LLM Rerank] Batch rerank failed [${error.status || '?'}]: ${error.message}`);
        }
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
          ...this._reasoningParam(),
        });

        const text = this._extractContent(response, 'classify').trim().toLowerCase();
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
        if (error.status === 404 || (error.message && error.message.includes('404'))) {
          console.error(`[LLM] ⚠️ 모델 '${this.model}'을(를) Cerebras가 인식하지 못함(404). 폐기되었거나 잘못된 모델 ID일 수 있음 → CEREBRAS_MODEL 확인 필요. 전체 기사를 neutral로 폴백합니다.`);
        } else {
          console.error(`[LLM] Batch sentiment failed [${error.status || '?'}]: ${error.message}`);
        }
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
    // Cerebras 무료 티어는 '분당 요청 5개' 제한이 병목(토큰은 넉넉).
    // 상위 기사만 큰 배치로 분류해 요청 수를 5/분 이내로 유지한다. (60/20 = 3 요청)
    const LLM_CLASSIFY_LIMIT = 60;
    const BATCH_SIZE = 20;

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

  /**
   * 특정 분야(카테고리) 뉴스 헤드라인에서 '그 분야 인기 검색 키워드'를 인기순으로 추출.
   * 카테고리별 실시간 검색어 소스가 없어, 네이버 섹션 뉴스로 대체 생성하는 용도.
   * @param {string[]} headlines - 해당 섹션 최신 헤드라인 목록
   * @param {string} category - 분야명 (정치/경제/사회/생활/세계/IT)
   * @param {number} limit - 뽑을 키워드 수
   * @returns {Promise<string[]>} 인기순 키워드 배열 (최대 limit개)
   */
  async extractTrendingKeywords(headlines, category, limit = 10) {
    if (!Array.isArray(headlines) || headlines.length === 0) return [];

    const list = headlines.slice(0, 24).map((h, i) => `${i + 1}. ${h}`).join('\n');
    const prompt = `다음은 '${category}' 분야 최신 뉴스 헤드라인입니다.
이 분야에서 지금 가장 화제인 핵심 검색 키워드 ${limit}개를 인기(화제성) 순으로 뽑아주세요.

규칙:
- 같은 이슈를 다룬 헤드라인은 하나로 합치세요.
- 사람들이 실제로 검색할 만한 짧은 키워드 형태로 만드세요 (대략 3~15자: 인물명/사건명/제품명/핵심 이슈).
- 헤드라인 문장을 그대로 쓰지 말고 핵심만 압축하세요.
- '${category}' 분야와 무관하면 제외하세요.

헤드라인:
${list}

각 줄에 "번호. 키워드" 형식으로 정확히 ${limit}개만 출력:`;

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: 'You extract concise Korean trending search keywords for a given news category from headlines. Merge duplicate issues, output short searchable keywords, one "number. keyword" per line.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: limit * 24 + 60,
          ...this._reasoningParam(),
        });

        const text = this._extractContent(response, 'extractKeywords').trim();
        const seen = new Set();
        const keywords = [];
        for (const line of text.split('\n')) {
          // "1. 키워드" / "1) 키워드" / "- 키워드" 형태에서 키워드만 추출
          const m = line.match(/^\s*(?:\d+[.)]|[-•])?\s*(.+?)\s*$/);
          if (!m) continue;
          let kw = m[1].trim().replace(/^["'#]+|["']+$/g, '').trim();
          if (!kw || kw.length < 2 || kw.length > 40) continue;
          if (seen.has(kw)) continue;
          seen.add(kw);
          keywords.push(kw);
          if (keywords.length >= limit) break;
        }
        return keywords;
      } catch (error) {
        const isRetryable = attempt < MAX_RETRIES - 1 && (
          error.status === 429 || (error.message && error.message.includes('429')) ||
          (error.status >= 500 && error.status < 600)
        );
        if (isRetryable) {
          const delay = 1000 * (attempt + 1);
          console.warn(`[LLM] extractKeywords error [${error.status || '?'}], retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`[LLM] extractTrendingKeywords failed [${error.status || '?'}]: ${error.message}`);
        return [];
      }
    }
    return [];
  }

  /**
   * 실시간 급상승 검색어를 카테고리로 분류.
   * 프론트 "실시간 인기 키워드 상세" 화면의 카테고리 필터용.
   * (signal.bz 등 트렌드 소스가 카테고리를 제공하지 않아 LLM으로 추정)
   * @param {string[]} keywords - 분류할 검색어 목록
   * @returns {Promise<string[]>} keywords와 같은 순서의 카테고리 배열
   *   (정치/경제/사회/연예/스포츠/IT/생활/문화 중 하나, 실패 시 '기타')
   */
  async categorizeKeywords(keywords) {
    const CATS = ['정치', '경제', '사회', '연예', '스포츠', 'IT', '생활', '문화'];
    if (!Array.isArray(keywords) || keywords.length === 0) return [];

    const list = keywords.map((k, i) => `${i + 1}. ${k}`).join('\n');
    const prompt = `다음은 한국 실시간 급상승 검색어 목록입니다. 각 검색어를 아래 카테고리 중 하나로 분류하세요.
카테고리: ${CATS.join(', ')}

규칙:
- 반드시 위 카테고리 중 하나만 사용하세요.
- 인물/사건은 맥락으로 추정하세요 (정치인→정치, 운동선수/구단→스포츠, 배우/가수/방송→연예, 기업/제품/기술→IT 또는 경제).
- 판단이 애매하면 가장 가까운 카테고리를 고르세요.

검색어 목록:
${list}

각 줄에 "번호. 카테고리" 형식으로만 출력하세요:`;

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a Korean news keyword categorizer. Assign each trending search keyword to exactly one of the given categories. Output "number. category" per line, nothing else.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: keywords.length * 12 + 40,
          ...this._reasoningParam(),
        });

        const text = this._extractContent(response, 'categorize').trim();
        const results = keywords.map(() => '기타');

        for (const line of text.split('\n')) {
          const numMatch = line.match(/(\d+)/);
          if (!numMatch) continue;
          const idx = parseInt(numMatch[1], 10) - 1;
          if (idx < 0 || idx >= keywords.length) continue;
          const found = CATS.find(c => line.includes(c));
          if (found) results[idx] = found;
        }

        return results;
      } catch (error) {
        const isRetryable = attempt < MAX_RETRIES - 1 && (
          error.status === 429 || (error.message && error.message.includes('429')) ||
          (error.status >= 500 && error.status < 600)
        );
        if (isRetryable) {
          const delay = 1000 * (attempt + 1);
          console.warn(`[LLM] Categorize error [${error.status || '?'}], retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`[LLM] Keyword categorize failed [${error.status || '?'}]: ${error.message}`);
        return keywords.map(() => '기타');
      }
    }
    return keywords.map(() => '기타');
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
