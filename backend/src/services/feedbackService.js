const fs = require('fs');
const path = require('path');

const FEEDBACK_FILE = path.join(__dirname, '..', '..', 'data', 'feedback.json');

/**
 * Phase 3 — Item 9: 피드백 데이터 활용
 *
 * 기사별 👍/👎 피드백을 파일에 영속 저장하고,
 * 누적 피드백을 청크 점수 부스팅에 반영합니다.
 *
 * 부스팅 공식: boost = clamp(net_likes * 0.05, -0.2, +0.3)
 *   - net_likes = likes - dislikes
 *   - max boost (+0.3)  : 6 이상 net 좋아요
 *   - max penalty (-0.2): 4 이상 net 싫어요
 */
class FeedbackService {
  constructor() {
    this._data = this._load();
    console.log(`[FeedbackService] Loaded ${Object.keys(this._data).length} feedback entries`);
  }

  _load() {
    try {
      if (fs.existsSync(FEEDBACK_FILE)) {
        return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf-8'));
      }
    } catch (err) {
      console.warn(`[FeedbackService] Failed to load feedback file: ${err.message}`);
    }
    return {};
  }

  _save() {
    try {
      const dir = path.dirname(FEEDBACK_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(this._data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[FeedbackService] Failed to save: ${err.message}`);
    }
  }

  /**
   * 피드백 제출
   * @param {string} articleId
   * @param {'like'|'dislike'} feedback
   * @returns {{ likes: number, dislikes: number }}
   */
  submit(articleId, feedback) {
    if (!this._data[articleId]) this._data[articleId] = { likes: 0, dislikes: 0 };
    if (feedback === 'like') this._data[articleId].likes++;
    else if (feedback === 'dislike') this._data[articleId].dislikes++;
    this._save();
    console.log(`[FeedbackService] ${feedback} for ${articleId}: ${JSON.stringify(this._data[articleId])}`);
    return this._data[articleId];
  }

  /**
   * 기사 ID에 대한 RRF 점수 부스트 값 반환 (-0.2 ~ +0.3)
   * @param {string} articleId
   * @returns {number}
   */
  getBoost(articleId) {
    const entry = this._data[articleId];
    if (!entry) return 0;
    const net = entry.likes - entry.dislikes;
    return Math.max(-0.2, Math.min(0.3, net * 0.05));
  }

  /**
   * 피드백 통계 조회
   */
  getStats() {
    const entries = Object.entries(this._data);
    return {
      total_articles: entries.length,
      total_likes: entries.reduce((s, [, v]) => s + v.likes, 0),
      total_dislikes: entries.reduce((s, [, v]) => s + v.dislikes, 0),
      articles: this._data,
    };
  }

  /**
   * 특정 기사의 피드백 조회
   */
  get(articleId) {
    return this._data[articleId] || { likes: 0, dislikes: 0 };
  }
}

let _instance = null;
function getFeedbackService() {
  if (!_instance) _instance = new FeedbackService();
  return _instance;
}

module.exports = { FeedbackService, getFeedbackService };
