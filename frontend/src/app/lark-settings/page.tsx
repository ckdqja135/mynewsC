'use client';

import { useState, useEffect } from 'react';
import { NewsApiService } from '@/services/newsApi';
import type { SentimentType, LarkConfig } from '@/types/news';
import styles from './lark-settings.module.css';
import Link from 'next/link';

export default function LarkSettingsPage() {
  const [larkEnabled, setLarkEnabled] = useState(false);
  const [larkWebhookUrl, setLarkWebhookUrl] = useState('');
  const [larkSchedule, setLarkSchedule] = useState('0 9 * * *');
  const [larkCustomSchedule, setLarkCustomSchedule] = useState('');
  const [larkSentimentTypes, setLarkSentimentTypes] = useState<Set<SentimentType>>(
    new Set(['negative'])
  );
  const [larkQuery, setLarkQuery] = useState('');
  const [larkTestLoading, setLarkTestLoading] = useState(false);
  const [larkTestMessage, setLarkTestMessage] = useState('');
  const [excludedSources, setExcludedSources] = useState<Set<string>>(new Set());
  const [maxArticles, setMaxArticles] = useState(200);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    // Load Lark config
    const loadLarkConfig = async () => {
      try {
        const config = await NewsApiService.getLarkSchedule();
        if (config) {
          setLarkEnabled(config.enabled);
          setLarkWebhookUrl(config.webhookUrl);
          setLarkSchedule(config.schedule);
          setLarkQuery(config.query);
          setLarkSentimentTypes(new Set(config.sentimentTypes));
          setMaxArticles(config.num || 200);
          setExcludedSources(new Set(config.excluded_sources || []));
        }
      } catch (error) {
        console.error('Failed to load Lark config:', error);
      }
    };

    // Load excluded sources
    const savedExcludedSources = localStorage.getItem('excludedSources');
    if (savedExcludedSources) {
      try {
        const parsed = JSON.parse(savedExcludedSources);
        if (Array.isArray(parsed)) {
          setExcludedSources(new Set(parsed));
        }
      } catch (e) {
        console.error('Failed to load excluded sources:', e);
      }
    }

    loadLarkConfig();
  }, []);

  const handleSendTestLark = async () => {
    if (!larkWebhookUrl || !larkQuery) {
      setLarkTestMessage('Webhook URL과 검색어를 입력해주세요');
      return;
    }

    setLarkTestLoading(true);
    setLarkTestMessage('');

    try {
      const result = await NewsApiService.sendLarkManual({
        webhookUrl: larkWebhookUrl,
        query: larkQuery,
        sentimentTypes: Array.from(larkSentimentTypes),
        num: 20,
        excluded_sources: Array.from(excludedSources)
      });

      setLarkTestMessage(`✅ 전송 성공! ${result.articlesSent}개 기사 전송됨`);
      setTimeout(() => setLarkTestMessage(''), 5000);
    } catch (error) {
      setLarkTestMessage(`❌ 전송 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLarkTestLoading(false);
    }
  };

  const handleSave = async () => {
    setSaveLoading(true);
    setSaveMessage('');

    try {
      const config: LarkConfig = {
        enabled: larkEnabled,
        schedule: larkSchedule === 'custom' ? larkCustomSchedule : larkSchedule,
        webhookUrl: larkWebhookUrl,
        query: larkQuery,
        sentimentTypes: Array.from(larkSentimentTypes),
        num: maxArticles,
        excluded_sources: Array.from(excludedSources)
      };

      await NewsApiService.saveLarkSchedule(config);
      setSaveMessage('✅ 설정이 저장되었습니다');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage(`❌ 저장 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>← 검색으로 돌아가기</Link>
        <h1>🔔 Lark 알림 설정</h1>
        <p>뉴스 알림을 Lark 메신저로 자동 전송합니다</p>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.section}>
            <h2>⚙️ 기본 설정</h2>

            <div className={styles.field}>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={larkEnabled}
                  onChange={(e) => setLarkEnabled(e.target.checked)}
                  className={styles.toggleCheckbox}
                />
                <span className={styles.toggleText}>정기 알림 활성화</span>
              </label>
              <p className={styles.helpText}>
                활성화하면 설정한 주기마다 자동으로 뉴스를 분석하여 Lark로 전송합니다
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Webhook URL *</label>
              <input
                type="text"
                value={larkWebhookUrl}
                onChange={(e) => setLarkWebhookUrl(e.target.value)}
                placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/..."
                className={styles.input}
              />
              <p className={styles.helpText}>
                Lark 봇 설정에서 Webhook URL을 복사하여 입력하세요
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>검색어 *</label>
              <input
                type="text"
                value={larkQuery}
                onChange={(e) => setLarkQuery(e.target.value)}
                placeholder="예: AI 뉴스, 경제 동향, 기술 트렌드"
                className={styles.input}
              />
              <p className={styles.helpText}>
                이 검색어로 뉴스를 수집하고 분석합니다
              </p>
            </div>
          </div>

          <div className={styles.section}>
            <h2>⏰ 알림 주기</h2>

            <div className={styles.field}>
              <label className={styles.label}>스케줄 선택</label>
              <select
                value={larkSchedule}
                onChange={(e) => setLarkSchedule(e.target.value)}
                className={styles.select}
              >
                <option value="0 9 * * *">매일 오전 9시</option>
                <option value="0 9 * * 1-5">평일 오전 9시</option>
                <option value="0 9,18 * * *">매일 오전 9시, 오후 6시</option>
                <option value="0 */6 * * *">6시간마다</option>
                <option value="0 9 * * 1">매주 월요일 9시</option>
                <option value="custom">직접 입력 (cron 표현식)</option>
              </select>

              {larkSchedule === 'custom' && (
                <input
                  type="text"
                  value={larkCustomSchedule}
                  onChange={(e) => setLarkCustomSchedule(e.target.value)}
                  placeholder="0 9 * * * (분 시 일 월 요일)"
                  className={styles.input}
                  style={{ marginTop: '12px' }}
                />
              )}
              <p className={styles.helpText}>
                Cron 표현식 예시: "0 9 * * *" = 매일 오전 9시 (서버 시간대: Asia/Seoul)
              </p>
            </div>
          </div>

          <div className={styles.section}>
            <h2>🎯 감성 필터</h2>

            <div className={styles.field}>
              <label className={styles.label}>알림받을 감성 유형</label>
              <div className={styles.checkboxGroup}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={larkSentimentTypes.has('negative')}
                    onChange={(e) => {
                      const newTypes = new Set(larkSentimentTypes);
                      if (e.target.checked) {
                        newTypes.add('negative');
                      } else {
                        newTypes.delete('negative');
                      }
                      setLarkSentimentTypes(newTypes);
                    }}
                  />
                  <span className={styles.sentimentBadge} style={{ backgroundColor: '#ffebee', color: '#f44336' }}>
                    😟 부정 뉴스
                  </span>
                </label>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={larkSentimentTypes.has('positive')}
                    onChange={(e) => {
                      const newTypes = new Set(larkSentimentTypes);
                      if (e.target.checked) {
                        newTypes.add('positive');
                      } else {
                        newTypes.delete('positive');
                      }
                      setLarkSentimentTypes(newTypes);
                    }}
                  />
                  <span className={styles.sentimentBadge} style={{ backgroundColor: '#e8f5e9', color: '#4caf50' }}>
                    😊 긍정 뉴스
                  </span>
                </label>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={larkSentimentTypes.has('neutral')}
                    onChange={(e) => {
                      const newTypes = new Set(larkSentimentTypes);
                      if (e.target.checked) {
                        newTypes.add('neutral');
                      } else {
                        newTypes.delete('neutral');
                      }
                      setLarkSentimentTypes(newTypes);
                    }}
                  />
                  <span className={styles.sentimentBadge} style={{ backgroundColor: '#fff3e0', color: '#ff9800' }}>
                    😐 중립 뉴스
                  </span>
                </label>
              </div>
              <p className={styles.helpText}>
                선택한 감성의 기사만 Lark로 전송됩니다
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>최대 기사 수</label>
              <select
                value={maxArticles}
                onChange={(e) => setMaxArticles(Number(e.target.value))}
                className={styles.select}
              >
                <option value={50}>50개 (빠름)</option>
                <option value={100}>100개 (보통)</option>
                <option value={200}>200개 (권장)</option>
                <option value={300}>300개</option>
                <option value={500}>500개</option>
              </select>
              <p className={styles.helpText}>
                크롤링할 최대 기사 수입니다. Lark 메시지에는 상위 10개만 전송됩니다
              </p>
            </div>
          </div>

          <div className={styles.section}>
            <h2>🧪 테스트</h2>

            <div className={styles.field}>
              <button
                onClick={handleSendTestLark}
                disabled={larkTestLoading || !larkWebhookUrl || !larkQuery}
                className={styles.testButton}
              >
                {larkTestLoading ? '전송 중...' : '테스트 전송'}
              </button>
              <p className={styles.helpText}>
                현재 설정으로 Lark 메시지를 즉시 전송해봅니다
              </p>
              {larkTestMessage && (
                <div className={larkTestMessage.startsWith('✅') ? styles.successMessage : styles.errorMessage}>
                  {larkTestMessage}
                </div>
              )}
            </div>
          </div>

          <div className={styles.actions}>
            <button onClick={handleSave} disabled={saveLoading} className={styles.saveButton}>
              {saveLoading ? '저장 중...' : '설정 저장'}
            </button>
            {saveMessage && (
              <div className={saveMessage.startsWith('✅') ? styles.successMessage : styles.errorMessage}>
                {saveMessage}
              </div>
            )}
          </div>
        </div>

        <div className={styles.infoCard}>
          <h3>💡 감성 분류 기준</h3>
          <div className={styles.infoContent}>
            <p>AI가 뉴스 전체를 분석하여 감성을 판단합니다:</p>
            <ol>
              <li><strong>긍정/부정 키워드 추출:</strong> AI가 "긍정적 측면"과 "부정적 측면"에서 키워드를 추출합니다</li>
              <li><strong>기사별 매칭:</strong> 각 기사의 제목과 본문에서 키워드가 얼마나 나타나는지 카운트합니다</li>
              <li><strong>감성 결정:</strong>
                <ul>
                  <li>긍정 키워드 &gt; 부정 키워드 → <strong style={{ color: '#4caf50' }}>긍정</strong></li>
                  <li>부정 키워드 &gt; 긍정 키워드 → <strong style={{ color: '#f44336' }}>부정</strong></li>
                  <li>비슷하거나 키워드 없음 → <strong style={{ color: '#ff9800' }}>중립</strong></li>
                </ul>
              </li>
            </ol>
            <p style={{ marginTop: '12px', fontSize: '13px', color: '#666' }}>
              예시: AI가 "경제 성장, 투자 증가"를 긍정 키워드로, "위험 증가, 규제 강화"를 부정 키워드로 추출했다면,
              "경제 성장과 투자 증가"가 포함된 기사는 긍정으로 분류됩니다.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
