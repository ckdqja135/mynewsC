/**
 * Article Sentiment Classifier
 *
 * LLM 분석 결과에서 키워드를 추출하고 기사를 감성별로 분류하는 서비스
 */

class ArticleSentimentClassifier {
  constructor() {
    // 한국어 불용어 목록 (조사, 접속사 등)
    this.stopwords = new Set([
      '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '로', '으로',
      '에서', '부터', '까지', '에게', '한테', '께', '보다', '처럼', '같이', '마다', '마저',
      '조차', '밖에', '뿐', '대로', '이다', '하다', '있다', '없다', '되다', '이', '그', '저',
      '것', '수', '등', '및', '또', '또한', '및', '때문', '위해', '통해', '따라', '대한',
      '에서의', '에게의', '이나', '거나', '든지', '라도', '라든가', '부터', '까지'
    ]);

    // 강제 부정 키워드 목록 (매우 명확한 부정적 사건만)
    this.forceNegativeKeywords = [
      '이물질 검출', '리콜', '회수 조치', '사망자', '사망 사고', '폭발 사고', '화재 발생',
      '중상자', '사상자 발생', '오염 물질', '유해 물질', '독성 물질',
      '발암 물질', '위반 적발', '구속', '체포', '불법 행위',
      '횡령', '배임', '결함 발견', '불량품', '제품 하자',
      '오작동 사고', '붕괴 사고', '침수 피해', '침몰 사고', '추락 사고',
      '누출 사고', '유출 사고', '집단 감염', '확진자 급증'
    ];

    // 강제 긍정 키워드 목록 (명확한 성과/긍정 지표)
    this.forcePositiveKeywords = [
      '대상 수상', '최고상 수상', '1위 달성', '우승', '세계 최초', '국내 최초',
      '신기록 달성', '쾌거', '극찬', '혁신상',
      '호재', '급등', '급동', '호실적', '대박', '흥행', '호평', '완판',
      '성공적', '성과', '수상', '쾌속', '상승세', '호조', '성장세',
      '돌풍', '인기', '매진', '최고 실적', '역대 최고', '기록 경신'
    ];
  }

  /**
   * 텍스트에서 키워드 추출
   * @param {string} aspectText - 감성 측면 텍스트
   * @returns {string[]} 추출된 키워드 배열
   */
  extractKeywords(aspectText) {
    if (!aspectText || typeof aspectText !== 'string') {
      return [];
    }

    // 공백으로 분리
    const words = aspectText.split(/\s+/);

    // 키워드 필터링
    const keywords = words
      .map(word => word.trim())
      .filter(word => {
        // 최소 2글자 이상
        if (word.length < 2) return false;

        // 불용어 제거
        if (this.stopwords.has(word)) return false;

        // 특수문자만 있는 단어 제거
        if (/^[\W_]+$/.test(word)) return false;

        return true;
      })
      // 중복 제거
      .filter((word, index, self) => self.indexOf(word) === index);

    return keywords;
  }

  /**
   * 기사 제목에서 키워드 매칭 점수 계산
   * @param {Object} article - 기사 객체
   * @param {string[]} keywords - 매칭할 키워드 배열
   * @returns {number} 매칭 점수
   */
  matchKeywords(article, keywords) {
    if (!keywords || keywords.length === 0) {
      return 0;
    }

    const title = (article.title || '').toLowerCase();
    let score = 0;

    keywords.forEach(keyword => {
      const keywordLower = keyword.toLowerCase();

      // 제목에서만 매칭
      if (title.includes(keywordLower)) {
        score += 1;
      }
    });

    return score;
  }

  /**
   * 강제 키워드 체크 (제목에만 적용)
   * @param {Object} article - 기사 객체
   * @returns {string|null} 강제 감성 ('positive', 'negative', null)
   */
  checkForceKeywords(article) {
    const title = (article.title || '').toLowerCase();

    // 강제 부정 키워드 체크 (제목에만)
    for (const keyword of this.forceNegativeKeywords) {
      if (title.includes(keyword)) {
        console.log(`[Sentiment] Force negative: "${keyword}" found in title`);
        return 'negative';
      }
    }

    // 강제 긍정 키워드 체크 (제목에만)
    for (const keyword of this.forcePositiveKeywords) {
      if (title.includes(keyword)) {
        console.log(`[Sentiment] Force positive: "${keyword}" found in title`);
        return 'positive';
      }
    }

    return null;
  }

  /**
   * 기사의 감성 분류
   * @param {Object} article - 기사 객체
   * @param {Object} sentimentAnalysis - LLM 감성 분석 결과
   * @param {string} query - 검색 키워드
   * @returns {Object} 감성 분류 결과
   */
  classifyArticle(article, sentimentAnalysis, query = '') {
    const title = (article.title || '').toLowerCase();

    // 0단계: 제목에 검색 키워드가 있는지 확인
    if (query) {
      const queryKeywords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
      const titleHasQuery = queryKeywords.some(qk => title.includes(qk));

      // 제목에 검색 키워드가 없으면 중립
      if (!titleHasQuery) {
        return {
          sentiment: 'neutral',
          score: 0,
          keywords: [],
          forced: false
        };
      }
    }

    // 1단계: 강제 키워드 체크 (우선순위 최상위)
    const forcedSentiment = this.checkForceKeywords(article);
    if (forcedSentiment) {
      return {
        sentiment: forcedSentiment,
        score: 100, // 강제 분류는 높은 점수
        keywords: forcedSentiment === 'negative' ? this.forceNegativeKeywords : this.forcePositiveKeywords,
        forced: true
      };
    }

    // 2단계: LLM 기반 감성 분류
    // 감성 분석 결과가 없으면 중립으로 처리
    if (!sentimentAnalysis) {
      return {
        sentiment: 'neutral',
        score: 0,
        keywords: [],
        forced: false
      };
    }

    // 긍정/부정 측면에서 키워드 추출
    const positiveKeywords = this.extractKeywords(
      (sentimentAnalysis.positive_aspects || []).join(' ')
    );
    const negativeKeywords = this.extractKeywords(
      (sentimentAnalysis.negative_aspects || []).join(' ')
    );

    // 키워드 매칭 점수 계산 (제목에서만)
    const positiveScore = this.matchKeywords(article, positiveKeywords);
    const negativeScore = this.matchKeywords(article, negativeKeywords);

    // 임계값: 제목에 최소 1개 키워드, 명확한 차이
    const threshold = 1;
    const minDifference = 1;

    // 감성 분류 로직
    if (positiveScore >= threshold && positiveScore > negativeScore && positiveScore - negativeScore >= minDifference) {
      return {
        sentiment: 'positive',
        score: positiveScore,
        keywords: positiveKeywords,
        forced: false
      };
    } else if (negativeScore >= threshold && negativeScore > positiveScore && negativeScore - positiveScore >= minDifference) {
      return {
        sentiment: 'negative',
        score: negativeScore,
        keywords: negativeKeywords,
        forced: false
      };
    } else {
      return {
        sentiment: 'neutral',
        score: 0,
        keywords: [],
        forced: false
      };
    }
  }

  /**
   * 모든 기사에 감성 태그 추가
   * @param {Array} articles - 기사 배열
   * @param {Object} sentimentAnalysis - LLM 감성 분석 결과
   * @param {string} query - 검색 키워드
   * @returns {Array} 감성 태그가 추가된 기사 배열
   */
  classifyArticles(articles, sentimentAnalysis, query = '') {
    if (!Array.isArray(articles)) {
      console.warn('[ArticleSentimentClassifier] Invalid articles array');
      return [];
    }

    return articles.map(article => {
      const classification = this.classifyArticle(article, sentimentAnalysis, query);
      return {
        ...article,
        sentiment: classification.sentiment,
        sentimentScore: classification.score,
        matchedKeywords: classification.keywords
      };
    });
  }

  /**
   * 감성별로 기사 필터링
   * @param {Array} articles - 감성이 태그된 기사 배열
   * @param {Array} sentimentTypes - 필터링할 감성 타입 배열 (예: ['positive', 'negative'])
   * @returns {Array} 필터링된 기사 배열
   */
  filterBySentiment(articles, sentimentTypes) {
    if (!Array.isArray(articles)) {
      console.warn('[ArticleSentimentClassifier] Invalid articles array');
      return [];
    }

    if (!Array.isArray(sentimentTypes) || sentimentTypes.length === 0) {
      return articles;
    }

    return articles.filter(article =>
      sentimentTypes.includes(article.sentiment)
    );
  }

  /**
   * 감성별 기사 개수 통계
   * @param {Array} articles - 감성이 태그된 기사 배열
   * @returns {Object} 감성별 개수
   */
  getStatistics(articles) {
    if (!Array.isArray(articles)) {
      return { positive: 0, negative: 0, neutral: 0 };
    }

    const stats = {
      positive: 0,
      negative: 0,
      neutral: 0
    };

    articles.forEach(article => {
      if (article.sentiment === 'positive') {
        stats.positive++;
      } else if (article.sentiment === 'negative') {
        stats.negative++;
      } else {
        stats.neutral++;
      }
    });

    return stats;
  }

  /**
   * LLM을 사용하여 모든 기사의 감성 분석 (더 정확한 방식)
   * @param {Array} articles - 기사 배열
   * @param {Object} llmService - LLM 서비스 인스턴스
   * @param {string} query - 검색 키워드
   * @returns {Promise<Array>} 감성 태그가 추가된 기사 배열
   */
  async classifyArticlesWithLLM(articles, llmService, query) {
    if (!Array.isArray(articles)) {
      console.warn('[ArticleSentimentClassifier] Invalid articles array');
      return [];
    }

    console.log(`[ArticleSentimentClassifier] Using LLM to classify ${articles.length} articles...`);

    try {
      // LLM으로 각 기사 감성 분석
      const classifiedArticles = await llmService.analyzeSentimentBatch(articles, query);

      // 추가 메타데이터 포함
      return classifiedArticles.map(article => ({
        ...article,
        sentimentScore: 100, // LLM 분류는 높은 신뢰도
        matchedKeywords: [],
        classificationMethod: 'llm'
      }));
    } catch (error) {
      console.error('[ArticleSentimentClassifier] LLM classification failed:', error.message);
      // 실패 시 모두 중립으로 처리
      return articles.map(article => ({
        ...article,
        sentiment: 'neutral',
        sentimentScore: 0,
        matchedKeywords: [],
        classificationMethod: 'fallback'
      }));
    }
  }
}

module.exports = { ArticleSentimentClassifier };
