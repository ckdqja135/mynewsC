/**
 * Telegram Bot Service
 *
 * Telegram Bot API로 뉴스 분석 결과를 전송하는 서비스
 *
 * Lark(larkBot.js)와 달리 텔레그램은 다음 두 가지가 필요합니다:
 *   - botToken: @BotFather에서 봇 생성 시 발급 (예: 123456789:AAExxxxxxxx...)
 *   - chatId:   메시지를 받을 대상 (개인/그룹/채널 ID 또는 @채널이름)
 *
 * 또한 텔레그램은 Lark의 Interactive Card가 없으므로, 카드 대신
 * HTML 파싱 모드(parse_mode: 'HTML')의 텍스트 메시지로 전송합니다.
 * (텍스트 메시지는 최대 4096자 제한이 있어 초과 시 잘라냅니다.)
 */

const axios = require('axios');

class TelegramBotService {
  constructor() {
    // Telegram Bot API 베이스 URL
    this.apiBase = 'https://api.telegram.org';

    // 봇 토큰 패턴: "숫자:영숫자_-" (BotFather 발급 형식)
    this.botTokenPattern = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

    // 텔레그램 텍스트 메시지 최대 길이
    this.MAX_MESSAGE_LENGTH = 4096;
  }

  /**
   * 봇 토큰 유효성 검증
   * @param {string} token - 봇 토큰
   * @returns {boolean} 유효 여부
   */
  validateBotToken(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }
    return this.botTokenPattern.test(token.trim());
  }

  /**
   * chat_id 유효성 검증
   * 숫자 ID(그룹은 음수), 또는 "@채널이름" 형식 허용
   * @param {string|number} chatId - chat_id
   * @returns {boolean} 유효 여부
   */
  validateChatId(chatId) {
    if (chatId === undefined || chatId === null) {
      return false;
    }
    const s = String(chatId).trim();
    if (!s) {
      return false;
    }
    // 숫자 ID(음수 포함) 또는 @로 시작하는 채널 이름
    return /^-?\d+$/.test(s) || /^@[A-Za-z0-9_]{4,}$/.test(s);
  }

  /**
   * HTML 특수문자 이스케이프 (parse_mode: 'HTML'용)
   * @param {*} text - 원본 텍스트
   * @returns {string} 이스케이프된 텍스트
   */
  escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')  // href 등 속성값 안의 따옴표가 태그를 깨지 않도록
      .replace(/'/g, '&#39;');
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
   * 텔레그램 HTML 메시지 포맷팅
   * @param {string} query - 검색어
   * @param {Array} articles - 기사 배열 (감성 태그 포함)
   * @param {Object} analysis - LLM 분석 결과
   * @param {Array} sentimentTypes - 필터링된 감성 타입
   * @returns {string} 텔레그램 HTML 메시지 텍스트
   */
  formatAnalysisMessage(query, articles, analysis, sentimentTypes) {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    // 감성 타입 라벨
    const sentimentLabels = sentimentTypes
      .map(type => this.getSentimentEmoji(type) + ' ' + this.getSentimentLabel(type))
      .join(', ');

    const lines = [];

    // 1. 헤더
    lines.push('🤖 <b>AI 뉴스 분석 알림</b>');
    lines.push('');
    lines.push(`🔍 <b>검색어:</b> ${this.escapeHtml(query)}`);
    lines.push(`📅 <b>분석 시간:</b> ${this.escapeHtml(now)}`);
    lines.push(`🎯 <b>감성 필터:</b> ${this.escapeHtml(sentimentLabels)}`);

    // 2. 요약
    if (analysis && analysis.summary) {
      lines.push('');
      lines.push('📋 <b>요약</b>');
      // 이스케이프 전에 잘라야 &amp; 같은 엔티티가 중간에 잘리지 않음
      const summary = String(analysis.summary);
      const shortSummary = summary.length > 1200 ? summary.slice(0, 1200) + '…' : summary;
      lines.push(this.escapeHtml(shortSummary));
    }

    // 3. 감성 분석
    if (analysis && analysis.sentiment) {
      const { positive_aspects, negative_aspects } = analysis.sentiment;

      if (Array.isArray(positive_aspects) && positive_aspects.length > 0) {
        lines.push('');
        lines.push('✅ <b>긍정적 측면</b>');
        positive_aspects.slice(0, 3).forEach(aspect => {
          lines.push(`• ${this.escapeHtml(aspect)}`);
        });
      }

      if (Array.isArray(negative_aspects) && negative_aspects.length > 0) {
        lines.push('');
        lines.push('⚠️ <b>부정적 측면</b>');
        negative_aspects.slice(0, 3).forEach(aspect => {
          lines.push(`• ${this.escapeHtml(aspect)}`);
        });
      }
    }

    // 4. 기사 목록 (최대 10개)
    const articleCount = Math.min(articles.length, 10);
    lines.push('');
    lines.push(`📰 <b>관련 기사 (${articleCount}개)</b>`);

    articles.slice(0, 10).forEach((article, index) => {
      const emoji = this.getSentimentEmoji(article.sentiment);
      const title = this.escapeHtml(article.title || 'No Title');
      const source = this.escapeHtml(article.source || 'Unknown Source');
      const url = article.url || '#';

      lines.push(`${emoji} <b>${index + 1}.</b> <a href="${this.escapeHtml(url)}">${title}</a> — ${source}`);
    });

    // 5. 푸터
    if (articles.length > 10) {
      lines.push('');
      lines.push(`<i>외 ${articles.length - 10}개 기사가 더 있습니다.</i>`);
    }

    // 텔레그램 4096자 제한 처리
    // 문자열 중간을 자르면 <a href="..."> 같은 태그가 잘려 HTML 파싱 에러가 나므로,
    // 반드시 "줄 단위"로만 담고 예산을 넘기면 그 줄부터 통째로 버린다 (태그는 각 줄 안에서 완결됨).
    const suffix = '\n\n<i>...(메시지가 길어 일부 생략되었습니다)</i>';
    const budget = this.MAX_MESSAGE_LENGTH - suffix.length;

    const kept = [];
    let length = 0;
    let truncated = false;
    for (const line of lines) {
      const addition = (kept.length > 0 ? 1 : 0) + line.length; // 개행 문자 포함
      if (length + addition > budget) {
        truncated = true;
        break;
      }
      kept.push(line);
      length += addition;
    }

    let text = kept.join('\n');
    if (truncated) {
      text += suffix;
    }

    return text;
  }

  /**
   * Telegram Bot API로 메시지 전송
   * @param {string} botToken - 봇 토큰
   * @param {string|number} chatId - chat_id
   * @param {string} text - 전송할 텍스트 (HTML)
   * @param {Object} [extra] - 추가 파라미터
   * @returns {Promise<Object>} 전송 결과
   */
  async sendMessage(botToken, chatId, text, extra = {}) {
    const url = `${this.apiBase}/bot${botToken}/sendMessage`;

    const body = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra
    };

    try {
      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10초 타임아웃
      });

      console.log('[TelegramBot] Message sent successfully:', response.data && response.data.ok);

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('[TelegramBot] Send failed:', error.message);

      if (error.response) {
        // 텔레그램은 실패 시 { ok:false, error_code, description } 형태로 응답
        const data = error.response.data || {};
        console.error('[TelegramBot] Response error:', data);
        const description = data.description || JSON.stringify(data);
        throw new Error(
          `Telegram API error: ${error.response.status} - ${description}`
        );
      } else if (error.request) {
        throw new Error('No response from Telegram API. Please check the bot token / network.');
      } else {
        throw new Error(`Failed to send Telegram message: ${error.message}`);
      }
    }
  }

  /**
   * 뉴스 분석 결과를 텔레그램으로 전송
   * @param {string} botToken - 봇 토큰
   * @param {string|number} chatId - chat_id
   * @param {string} query - 검색어
   * @param {Array} articles - 기사 배열 (감성 태그 포함)
   * @param {Object} analysis - LLM 분석 결과
   * @param {Array} sentimentTypes - 필터링된 감성 타입
   * @returns {Promise<Object>} 전송 결과
   */
  async sendNewsDigest(botToken, chatId, query, articles, analysis, sentimentTypes) {
    if (!this.validateBotToken(botToken)) {
      throw new Error('Invalid Telegram bot token format');
    }
    if (!this.validateChatId(chatId)) {
      throw new Error('Invalid Telegram chat_id');
    }

    if (!Array.isArray(articles) || articles.length === 0) {
      throw new Error('No articles to send');
    }

    const text = this.formatAnalysisMessage(query, articles, analysis, sentimentTypes);

    return await this.sendMessage(botToken, chatId, text);
  }

  /**
   * 실시간 핫 키워드(트렌드) 텔레그램 HTML 메시지 포맷팅
   * @param {Object} trending - trendingKeywords 서비스의 getTrending() 반환값
   *   { source, fetchedAt, items:[{ rank, keyword, stateEmoji, stateLabel, traffic }] }
   * @returns {string} 텔레그램 HTML 메시지 텍스트
   */
  formatTrendingMessage(trending) {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const items = trending && Array.isArray(trending.items) ? trending.items : [];
    const source = trending && trending.source ? trending.source : 'Unknown';

    const lines = [];

    // 1. 헤더
    lines.push('🔥 <b>실시간 핫 키워드</b>');
    lines.push('');
    lines.push(`📅 <b>기준 시각:</b> ${this.escapeHtml(now)}`);
    lines.push(`🌐 <b>출처:</b> ${this.escapeHtml(source)}`);
    lines.push('');

    // 2. 키워드 목록
    if (items.length === 0) {
      lines.push('<i>표시할 트렌드 키워드가 없습니다.</i>');
    } else {
      items.forEach((it, idx) => {
        const rank = it.rank != null ? it.rank : idx + 1;
        const keyword = it.keyword || '';
        // 키워드를 구글 검색 링크로 만들어 바로 확인 가능하게 함.
        // encodeURIComponent 결과에는 HTML 특수문자가 남지 않으므로 href에 안전하게 삽입된다.
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}`;
        const badge = it.stateEmoji ? `${it.stateEmoji} ` : '';
        const traffic = it.traffic ? ` — ${this.escapeHtml(it.traffic)}` : '';
        const state = it.stateLabel ? ` <i>(${this.escapeHtml(it.stateLabel)})</i>` : '';
        lines.push(
          `${badge}<b>${rank}.</b> <a href="${searchUrl}">${this.escapeHtml(keyword)}</a>${traffic}${state}`
        );
      });
    }

    // 텔레그램 4096자 제한 처리 (formatAnalysisMessage와 동일한 줄 단위 정책)
    const text = lines.join('\n');
    if (text.length <= this.MAX_MESSAGE_LENGTH) {
      return text;
    }

    const suffix = '\n\n<i>...(메시지가 길어 일부 생략되었습니다)</i>';
    const budget = this.MAX_MESSAGE_LENGTH - suffix.length;
    const kept = [];
    let length = 0;
    let truncated = false;
    for (const line of lines) {
      const addition = (kept.length > 0 ? 1 : 0) + line.length;
      if (length + addition > budget) {
        truncated = true;
        break;
      }
      kept.push(line);
      length += addition;
    }
    return kept.join('\n') + (truncated ? suffix : '');
  }

  /**
   * 실시간 핫 키워드를 텔레그램으로 전송
   * @param {string} botToken - 봇 토큰
   * @param {string|number} chatId - chat_id
   * @param {Object} trending - getTrending() 반환값
   * @returns {Promise<Object>} 전송 결과
   */
  async sendTrendingKeywords(botToken, chatId, trending) {
    if (!this.validateBotToken(botToken)) {
      throw new Error('Invalid Telegram bot token format');
    }
    if (!this.validateChatId(chatId)) {
      throw new Error('Invalid Telegram chat_id');
    }

    const text = this.formatTrendingMessage(trending);
    return await this.sendMessage(botToken, chatId, text);
  }

  /**
   * 간단한 텍스트 메시지 전송
   * @param {string} botToken - 봇 토큰
   * @param {string|number} chatId - chat_id
   * @param {string} text - 전송할 텍스트
   * @returns {Promise<Object>} 전송 결과
   */
  async sendSimpleMessage(botToken, chatId, text) {
    if (!this.validateBotToken(botToken)) {
      throw new Error('Invalid Telegram bot token format');
    }
    if (!this.validateChatId(chatId)) {
      throw new Error('Invalid Telegram chat_id');
    }

    // 일반 텍스트는 파싱 모드 없이 전송 (HTML 파싱 오류 방지)
    return await this.sendMessage(botToken, chatId, text, { parse_mode: undefined });
  }
}

module.exports = { TelegramBotService };
