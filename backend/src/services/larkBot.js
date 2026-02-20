/**
 * Lark Bot Service
 *
 * Lark (Feishu) 메신저로 뉴스 분석 결과를 전송하는 서비스
 */

const axios = require('axios');

class LarkBotService {
  constructor() {
    // Lark Webhook URL 패턴
    this.webhookUrlPattern = /^https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\/.+$/;
  }

  /**
   * Webhook URL 유효성 검증
   * @param {string} url - Webhook URL
   * @returns {boolean} 유효 여부
   */
  validateWebhookUrl(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    return this.webhookUrlPattern.test(url);
  }

  /**
   * 감성 이모지 가져오기
   * @param {string} sentiment - 감성 타입
   * @returns {string} 이모지
   */
  getSentimentEmoji(sentiment) {
    switch (sentiment) {
      case 'positive':
        return '🟢';
      case 'negative':
        return '🔴';
      case 'neutral':
        return '🟡';
      default:
        return '📰';
    }
  }

  /**
   * 감성 타입 한글 변환
   * @param {string} sentiment - 감성 타입
   * @returns {string} 한글 감성 타입
   */
  getSentimentLabel(sentiment) {
    switch (sentiment) {
      case 'positive':
        return '긍정';
      case 'negative':
        return '부정';
      case 'neutral':
        return '중립';
      default:
        return '기타';
    }
  }

  /**
   * Lark 메시지 카드 포맷팅
   * @param {string} query - 검색어
   * @param {Array} articles - 기사 배열 (감성 태그 포함)
   * @param {Object} analysis - LLM 분석 결과
   * @param {Array} sentimentTypes - 필터링된 감성 타입
   * @returns {Object} Lark 메시지 카드
   */
  formatAnalysisMessage(query, articles, analysis, sentimentTypes) {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    // 감성 타입 라벨
    const sentimentLabels = sentimentTypes
      .map(type => this.getSentimentEmoji(type) + ' ' + this.getSentimentLabel(type))
      .join(', ');

    // 메시지 요소 배열
    const elements = [];

    // 1. 헤더 정보
    elements.push({
      tag: 'div',
      text: {
        content: `**🔍 검색어:** ${query}\n**📅 분석 시간:** ${now}\n**🎯 감성 필터:** ${sentimentLabels}`,
        tag: 'lark_md'
      }
    });

    elements.push({ tag: 'hr' });

    // 2. 요약
    if (analysis && analysis.summary) {
      elements.push({
        tag: 'div',
        text: {
          content: `**📋 요약**\n${analysis.summary}`,
          tag: 'lark_md'
        }
      });
    }

    // 3. 감성 분석
    if (analysis && analysis.sentiment) {
      const sentimentContent = [];

      if (analysis.sentiment.positive_aspects && analysis.sentiment.positive_aspects.length > 0) {
        sentimentContent.push(`**✅ 긍정적 측면**`);
        analysis.sentiment.positive_aspects.slice(0, 3).forEach(aspect => {
          sentimentContent.push(`• ${aspect}`);
        });
      }

      if (analysis.sentiment.negative_aspects && analysis.sentiment.negative_aspects.length > 0) {
        sentimentContent.push(`**⚠️ 부정적 측면**`);
        analysis.sentiment.negative_aspects.slice(0, 3).forEach(aspect => {
          sentimentContent.push(`• ${aspect}`);
        });
      }

      if (sentimentContent.length > 0) {
        elements.push({
          tag: 'div',
          text: {
            content: sentimentContent.join('\n'),
            tag: 'lark_md'
          }
        });
      }
    }

    elements.push({ tag: 'hr' });

    // 4. 기사 목록 (최대 10개)
    const articleCount = Math.min(articles.length, 10);
    elements.push({
      tag: 'div',
      text: {
        content: `**📰 관련 기사 (${articleCount}개)**`,
        tag: 'lark_md'
      }
    });

    articles.slice(0, 10).forEach((article, index) => {
      const emoji = this.getSentimentEmoji(article.sentiment);
      const title = article.title || 'No Title';
      const source = article.source || 'Unknown Source';
      const url = article.url || '#';

      elements.push({
        tag: 'div',
        text: {
          content: `${emoji} **${index + 1}.** [${title}](${url})\n   📰 ${source}`,
          tag: 'lark_md'
        }
      });
    });

    // 5. 푸터 정보
    if (articles.length > 10) {
      elements.push({
        tag: 'div',
        text: {
          content: `\n_외 ${articles.length - 10}개 기사가 더 있습니다._`,
          tag: 'lark_md'
        }
      });
    }

    // Lark Interactive Card 구조
    return {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            content: '🤖 AI 뉴스 분석 알림',
            tag: 'plain_text'
          },
          template: 'blue'
        },
        elements
      }
    };
  }

  /**
   * Lark Webhook으로 메시지 전송
   * @param {string} webhookUrl - Lark Webhook URL
   * @param {Object} message - 전송할 메시지 객체
   * @returns {Promise<Object>} 전송 결과
   */
  async sendMessage(webhookUrl, message) {
    try {
      const response = await axios.post(webhookUrl, message, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10초 타임아웃
      });

      console.log('[LarkBot] Message sent successfully:', response.data);

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('[LarkBot] Send failed:', error.message);

      // 에러 상세 정보
      if (error.response) {
        console.error('[LarkBot] Response error:', error.response.data);
        throw new Error(
          `Lark API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        throw new Error('No response from Lark API. Please check the webhook URL.');
      } else {
        throw new Error(`Failed to send Lark message: ${error.message}`);
      }
    }
  }

  /**
   * 뉴스 분석 결과를 Lark로 전송
   * @param {string} webhookUrl - Lark Webhook URL
   * @param {string} query - 검색어
   * @param {Array} articles - 기사 배열 (감성 태그 포함)
   * @param {Object} analysis - LLM 분석 결과
   * @param {Array} sentimentTypes - 필터링된 감성 타입
   * @returns {Promise<Object>} 전송 결과
   */
  async sendNewsDigest(webhookUrl, query, articles, analysis, sentimentTypes) {
    // Webhook URL 검증
    if (!this.validateWebhookUrl(webhookUrl)) {
      throw new Error('Invalid Lark webhook URL format');
    }

    // 기사가 없으면 에러
    if (!Array.isArray(articles) || articles.length === 0) {
      throw new Error('No articles to send');
    }

    // 메시지 포맷팅
    const message = this.formatAnalysisMessage(query, articles, analysis, sentimentTypes);

    // 메시지 전송
    return await this.sendMessage(webhookUrl, message);
  }

  /**
   * 간단한 텍스트 메시지 전송
   * @param {string} webhookUrl - Lark Webhook URL
   * @param {string} text - 전송할 텍스트
   * @returns {Promise<Object>} 전송 결과
   */
  async sendSimpleMessage(webhookUrl, text) {
    if (!this.validateWebhookUrl(webhookUrl)) {
      throw new Error('Invalid Lark webhook URL format');
    }

    const message = {
      msg_type: 'text',
      content: {
        text
      }
    };

    return await this.sendMessage(webhookUrl, message);
  }
}

module.exports = { LarkBotService };
