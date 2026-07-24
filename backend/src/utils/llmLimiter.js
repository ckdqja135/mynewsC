/**
 * LLM 요청 큐 + 스로틀 (Cerebras 무료 티어 공유 한도 대응)
 *
 * Cerebras 무료 티어는 분당 요청/토큰 한도가 "계정 단위"로 공유된다.
 * 여러 사용자가 동시에 분석하면 순간적으로 한도를 초과해 429가 나고 실패한다.
 * 이 리미터는 모든 LLM 호출을
 *   (1) 동시 실행 수(maxConcurrent) 제한
 *   (2) 호출 시작 간 최소 간격(minIntervalMs)
 *   (3) 대기열 상한(maxQueue)
 * 으로 줄 세워 한도 아래로 페이싱한다 → "실패" 대신 "잠깐 대기 후 성공"으로 전환.
 *
 * 모든 값은 .env로 조절 가능하다. (LLM_MAX_CONCURRENT / LLM_MIN_INTERVAL_MS / LLM_MAX_QUEUE)
 */
class LlmLimiter {
  constructor({ maxConcurrent, minIntervalMs, maxQueue } = {}) {
    this.maxConcurrent = Math.max(1, maxConcurrent || 2);
    this.minIntervalMs = Math.max(0, Number.isFinite(minIntervalMs) ? minIntervalMs : 700);
    this.maxQueue = Math.max(1, maxQueue || 60);
    this._active = 0;
    this._lastStart = 0;
    this._queue = [];
    this._timer = null;
  }

  get active() {
    return this._active;
  }
  get pending() {
    return this._queue.length;
  }

  stats() {
    return {
      active: this._active,
      pending: this._queue.length,
      maxConcurrent: this.maxConcurrent,
      minIntervalMs: this.minIntervalMs,
      maxQueue: this.maxQueue,
    };
  }

  /**
   * task(비동기 함수)를 큐에 넣고, 슬롯이 나면 실행한다.
   * 대기열이 가득 차면 즉시 LLM_QUEUE_FULL 에러로 거절한다.
   * @param {() => Promise<any>} task
   * @returns {Promise<any>}
   */
  run(task) {
    return new Promise((resolve, reject) => {
      if (this._queue.length >= this.maxQueue) {
        const err = new Error('LLM_QUEUE_FULL');
        err.code = 'LLM_QUEUE_FULL';
        return reject(err);
      }
      this._queue.push({ task, resolve, reject });
      if (this._active + this._queue.length > this.maxConcurrent) {
        console.warn(`[LLM Limiter] 대기 중 (active=${this._active}, pending=${this._queue.length})`);
      }
      this._drain();
    });
  }

  _drain() {
    while (this._active < this.maxConcurrent && this._queue.length > 0) {
      const now = Date.now();
      const wait = this._lastStart + this.minIntervalMs - now;
      if (wait > 0) {
        // 최소 간격이 안 지났으면 타이머 한 개만 걸어두고 대기
        if (!this._timer) {
          this._timer = setTimeout(() => {
            this._timer = null;
            this._drain();
          }, wait);
        }
        return;
      }

      const { task, resolve, reject } = this._queue.shift();
      this._active++;
      this._lastStart = Date.now();

      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          this._active--;
          this._drain();
        });
    }
  }
}

// 전역 싱글턴 (모든 LLM 호출이 공유) — .env 값으로 설정
const envInt = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const llmLimiter = new LlmLimiter({
  maxConcurrent: envInt(process.env.LLM_MAX_CONCURRENT, 2),
  minIntervalMs: envInt(process.env.LLM_MIN_INTERVAL_MS, 700),
  maxQueue: envInt(process.env.LLM_MAX_QUEUE, 60),
});

module.exports = { LlmLimiter, llmLimiter };
