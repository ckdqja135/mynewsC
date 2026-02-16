/**
 * Scheduler Service
 *
 * node-cron을 사용하여 주기적 작업을 스케줄링하는 서비스
 */

const cron = require('node-cron');

class SchedulerService {
  constructor() {
    // jobId -> cron task
    this.jobs = new Map();
    // jobId -> config
    this.configs = new Map();
    // jobId -> last run time
    this.lastRuns = new Map();

    console.log('[Scheduler] Service initialized');
  }

  /**
   * Cron 표현식 유효성 검증
   * @param {string} expression - Cron 표현식
   * @returns {boolean} 유효 여부
   */
  validateCronExpression(expression) {
    if (!expression || typeof expression !== 'string') {
      return false;
    }
    return cron.validate(expression);
  }

  /**
   * 다음 실행 시간 추정 (간단한 구현)
   * @param {string} cronExpression - Cron 표현식
   * @returns {string} ISO 형식 날짜/시간
   */
  getNextRunTime(cronExpression) {
    // 간단한 구현: Cron 표현식에 따라 대략적인 다음 실행 시간 계산
    // 실제로는 cron-parser 같은 라이브러리를 사용하면 더 정확

    const parts = cronExpression.split(' ');
    if (parts.length !== 5) {
      // 기본값: 1시간 후
      return new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // 매분 실행
    if (minute === '*') {
      return new Date(Date.now() + 60 * 1000).toISOString();
    }

    // 매시간 실행
    if (hour === '*') {
      return new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }

    // 매일 실행
    if (dayOfMonth === '*' && month === '*') {
      return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }

    // 기본값: 1시간 후
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }

  /**
   * 스케줄 작업 추가/업데이트
   * @param {string} jobId - 작업 ID
   * @param {string} cronExpression - Cron 표현식
   * @param {Object} config - 작업 설정
   * @param {Function} taskFunction - 실행할 함수
   * @returns {Object} 작업 정보
   */
  addJob(jobId, cronExpression, config, taskFunction) {
    // Cron 표현식 검증
    if (!this.validateCronExpression(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    // 기존 작업이 있으면 중지
    if (this.jobs.has(jobId)) {
      console.log(`[Scheduler] Stopping existing job: ${jobId}`);
      this.jobs.get(jobId).stop();
      this.jobs.delete(jobId);
    }

    // 새 작업 생성
    const task = cron.schedule(
      cronExpression,
      async () => {
        console.log(`[Scheduler] Running job: ${jobId}`);
        const startTime = Date.now();

        try {
          await taskFunction(config);

          const duration = Date.now() - startTime;
          console.log(`[Scheduler] Job ${jobId} completed in ${duration}ms`);

          // 마지막 실행 시간 기록
          this.lastRuns.set(jobId, new Date().toISOString());
        } catch (error) {
          console.error(`[Scheduler] Job ${jobId} failed:`, error.message);
          console.error(error.stack);
        }
      },
      {
        scheduled: true,
        timezone: 'Asia/Seoul' // 한국 시간대
      }
    );

    // 작업 저장
    this.jobs.set(jobId, task);
    this.configs.set(jobId, {
      ...config,
      schedule: cronExpression,
      createdAt: new Date().toISOString()
    });

    console.log(`[Scheduler] Job ${jobId} scheduled with cron: ${cronExpression}`);

    return {
      jobId,
      cronExpression,
      nextRun: this.getNextRunTime(cronExpression),
      status: 'active'
    };
  }

  /**
   * 작업 제거
   * @param {string} jobId - 작업 ID
   * @returns {boolean} 제거 성공 여부
   */
  removeJob(jobId) {
    if (!this.jobs.has(jobId)) {
      console.warn(`[Scheduler] Job ${jobId} not found`);
      return false;
    }

    // 작업 중지
    this.jobs.get(jobId).stop();
    this.jobs.delete(jobId);
    this.configs.delete(jobId);
    this.lastRuns.delete(jobId);

    console.log(`[Scheduler] Job ${jobId} removed`);
    return true;
  }

  /**
   * 작업 일시 중지
   * @param {string} jobId - 작업 ID
   * @returns {boolean} 성공 여부
   */
  pauseJob(jobId) {
    if (!this.jobs.has(jobId)) {
      return false;
    }

    this.jobs.get(jobId).stop();
    console.log(`[Scheduler] Job ${jobId} paused`);
    return true;
  }

  /**
   * 작업 재개
   * @param {string} jobId - 작업 ID
   * @returns {boolean} 성공 여부
   */
  resumeJob(jobId) {
    if (!this.jobs.has(jobId)) {
      return false;
    }

    this.jobs.get(jobId).start();
    console.log(`[Scheduler] Job ${jobId} resumed`);
    return true;
  }

  /**
   * 특정 작업 정보 조회
   * @param {string} jobId - 작업 ID
   * @returns {Object|null} 작업 정보
   */
  getJob(jobId) {
    if (!this.configs.has(jobId)) {
      return null;
    }

    const config = this.configs.get(jobId);
    const lastRun = this.lastRuns.get(jobId) || null;
    const active = this.jobs.has(jobId);

    return {
      jobId,
      config,
      active,
      lastRun,
      nextRun: config.schedule ? this.getNextRunTime(config.schedule) : null
    };
  }

  /**
   * 모든 작업 목록 조회
   * @returns {Array} 작업 목록
   */
  listJobs() {
    const jobs = [];

    this.configs.forEach((config, jobId) => {
      jobs.push({
        jobId,
        config,
        active: this.jobs.has(jobId),
        lastRun: this.lastRuns.get(jobId) || null,
        nextRun: config.schedule ? this.getNextRunTime(config.schedule) : null
      });
    });

    return jobs;
  }

  /**
   * 모든 작업 중지
   */
  stopAll() {
    console.log(`[Scheduler] Stopping all ${this.jobs.size} jobs`);

    this.jobs.forEach((task, jobId) => {
      task.stop();
      console.log(`[Scheduler] Job ${jobId} stopped`);
    });

    this.jobs.clear();
    this.configs.clear();
    this.lastRuns.clear();
  }

  /**
   * 통계 정보
   * @returns {Object} 통계
   */
  getStatistics() {
    return {
      totalJobs: this.jobs.size,
      activeJobs: this.jobs.size,
      jobs: Array.from(this.configs.keys())
    };
  }
}

module.exports = { SchedulerService };
