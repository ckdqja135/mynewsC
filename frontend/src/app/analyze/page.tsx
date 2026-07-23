'use client';

import { useState, useEffect, useRef } from 'react';
import { NewsApiService } from '@/services/newsApi';
import type { NewsAnalysisResponse, AnalysisType, AnalysisSource } from '@/types/news';
import { SENTIMENT_META } from '@/constants/sentiment';
import styles from './analyze.module.css';

// 분석 관점 → 백엔드 analysis_type 매핑 (실제 백엔드가 지원하는 4종에 대응)
const PERSPECTIVES: { key: AnalysisType; name: string; desc: string }[] = [
  { key: 'comprehensive', name: '종합', desc: '감성·트렌드·핵심 포인트를 모두 포함한 가장 완전한 분석' },
  { key: 'sentiment', name: '논조', desc: '긍정·부정 측면과 전반적인 어조를 짚어 봅니다' },
  { key: 'key_points', name: '쟁점', desc: '가장 중요한 핵심 포인트와 논점을 정리합니다' },
  { key: 'trend', name: '트렌드', desc: '주요 토픽과 신흥 트렌드, 관심 흐름을 추적합니다' },
];

// 분석 깊이 → 기사 수(num) 매핑
const DEPTHS: { name: string; sub: string; num: number }[] = [
  { name: '빠르게', sub: '기사 30개 · 약 30초', num: 30 },
  { name: '표준', sub: '기사 100개 · 약 1분', num: 100 },
  { name: '심층', sub: '기사 500개 · 약 2~3분', num: 500 },
];

const LOAD_STEPS = ['관련 기사 수집 중', '본문 읽고 핵심 추출 중', '관점별 분석 정리 중', '리포트 작성 중'];

type Screen = 'form' | 'loading' | 'report';

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '출처';
  }
}

// 기사 제목 뒤에 스크래핑으로 붙는 '새 창 열림' 등 잔여 텍스트 정리
function cleanTitle(t: string): string {
  return (t || '').replace(/\s*새 창 열림\s*$/, '').trim();
}

export default function ReportPage() {
  const [topic, setTopic] = useState('');
  const [persp, setPersp] = useState(0);
  const [depth, setDepth] = useState(1);
  const [screen, setScreen] = useState<Screen>('form');
  const [loadStep, setLoadStep] = useState(0);
  const [report, setReport] = useState<NewsAnalysisResponse | null>(null);
  const [reportMeta, setReportMeta] = useState<{ persp: number; depth: number; topic: string } | null>(null);
  const [error, setError] = useState('');
  const [excludedSources, setExcludedSources] = useState<Set<string>>(new Set());

  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('excludedSources');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setExcludedSources(new Set(parsed));
      }
    } catch {
      /* 무시 */
    }
  }, []);

  useEffect(() => () => {
    if (stepTimer.current) clearInterval(stepTimer.current);
  }, []);

  const clearTimer = () => {
    if (stepTimer.current) {
      clearInterval(stepTimer.current);
      stepTimer.current = null;
    }
  };

  const run = async () => {
    if (runningRef.current) return;
    const t = topic.trim();
    if (!t) {
      setError('분석할 주제를 입력해주세요');
      return;
    }
    runningRef.current = true;
    setError('');
    setScreen('loading');
    setLoadStep(0);
    // 진행 단계 애니메이션 (마지막 단계에서 응답을 기다림)
    stepTimer.current = setInterval(() => {
      setLoadStep((s) => Math.min(s + 1, LOAD_STEPS.length - 1));
    }, 1300);

    try {
      const res = await NewsApiService.analyzeNews({
        q: t,
        hl: 'ko',
        gl: 'kr',
        num: DEPTHS[depth].num,
        analysis_type: PERSPECTIVES[persp].key,
        excluded_sources: Array.from(excludedSources),
      });
      setReport(res);
      setReportMeta({ persp, depth, topic: t });
      setScreen('report');
    } catch (e) {
      setError(e instanceof Error ? e.message : '분석에 실패했습니다');
      setScreen('form');
    } finally {
      clearTimer();
      runningRef.current = false;
    }
  };

  const reset = () => {
    setScreen('form');
    setReport(null);
    setError('');
  };

  const saveReport = () => {
    if (!report || !reportMeta) return;
    const lines: string[] = [
      `AI 분석 리포트 · ${reportMeta.topic}`,
      `${PERSPECTIVES[reportMeta.persp].name} 관점 · ${DEPTHS[reportMeta.depth].name} 분석 · 기사 ${report.articles_analyzed}개`,
      '',
      '[요약]',
      report.summary || '',
      '',
      '[핵심 포인트]',
      ...(report.key_points || []).map((p, i) => `${i + 1}. ${p}`),
    ];
    if (report.sources?.length) {
      lines.push('', '[분석에 사용된 기사]');
      report.sources.forEach((s) => lines.push(`- ${cleanTitle(s.title)} (${s.url})`));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI리포트-${reportMeta.topic}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ── 폼 화면 ──
  const renderForm = () => (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>AI 뉴스 분석</h1>
        <p className={styles.pageSub}>뉴스를 심층 분석해 리포트로 정리해 드립니다</p>
      </div>

      {error && <div className={styles.errorBanner}>❌ {error}</div>}

      <div className={styles.formCard}>
        <div className={styles.field}>
          <label htmlFor="topic" className={styles.fieldLabel}>어떤 주제를 분석할까요?</label>
          <input
            id="topic"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="예: 인공지능, 경제 동향, 기후 변화…"
            className={styles.topicInput}
          />
        </div>

        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <span className={styles.fieldLabelSm}>분석 관점</span>
            <span className={styles.fieldHint}>어떤 시각으로 볼지 선택하세요</span>
          </div>
          <div className={styles.optionRow}>
            {PERSPECTIVES.map((p, i) => (
              <button
                key={p.key}
                type="button"
                className={`${styles.optionBtn} ${persp === i ? styles.optionBtnOn : ''}`}
                onClick={() => setPersp(i)}
                aria-pressed={persp === i}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <span className={styles.fieldLabelSm}>분석 깊이</span>
            <span className={styles.fieldHint}>기사 수와 분석 강도가 달라져요</span>
          </div>
          <div className={styles.optionRow}>
            {DEPTHS.map((d, i) => (
              <button
                key={d.name}
                type="button"
                className={`${styles.optionBtnTall} ${depth === i ? styles.optionBtnOn : ''}`}
                onClick={() => setDepth(i)}
                aria-pressed={depth === i}
              >
                <span className={styles.optionName}>{d.name}</span>
                <span className={`${styles.optionSub} ${depth === i ? styles.optionSubOn : ''}`}>{d.sub}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.summaryLine}>
          <span className={styles.summaryBar} />
          <p className={styles.summaryText}>
            {PERSPECTIVES[persp].name} 분석: {PERSPECTIVES[persp].desc}
          </p>
        </div>

        <button type="button" className={styles.ctaButton} onClick={run}>
          AI 리포트 만들기
        </button>
      </div>
    </>
  );

  // ── 로딩 화면 ──
  const renderLoading = () => (
    <div className={styles.loadingWrap}>
      <div className={styles.loadingSpinner} />
      <div className={styles.loadingTexts}>
        <span className={styles.loadingTitle}>&lsquo;{topic.trim() || '주제'}&rsquo; 분석하고 있어요</span>
        <span className={styles.loadingSub}>잠시만 기다려 주세요</span>
      </div>
      <div className={styles.stepList}>
        {LOAD_STEPS.map((label, i) => {
          const done = i < loadStep;
          const current = i === loadStep;
          return (
            <div key={label} className={`${styles.stepRow} ${i <= loadStep ? styles.stepRowActive : ''}`}>
              <span className={`${styles.stepIcon} ${done ? styles.stepIconDone : current ? styles.stepIconCurrent : ''}`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={`${styles.stepText} ${current ? styles.stepTextCurrent : ''}`}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── 리포트 화면 ──
  const renderReport = () => {
    if (!report || !reportMeta) return null;
    const pName = PERSPECTIVES[reportMeta.persp].name;
    const depthName = DEPTHS[reportMeta.depth].name;

    // 감성 분포: LLM 종합 감성 점수(-1~1)를 3구간으로 투명하게 환산
    const s = Math.max(-1, Math.min(1, report.sentiment?.sentiment_score ?? 0));
    const pos = Math.round(Math.max(0, s) * 100);
    const neg = Math.round(Math.max(0, -s) * 100);
    const neu = Math.max(0, 100 - pos - neg);
    const dist = [
      { label: SENTIMENT_META.positive.label, pct: pos, color: '#4e9d7c' },
      { label: SENTIMENT_META.neutral.label, pct: neu, color: '#c4c9ce' },
      { label: SENTIMENT_META.negative.label, pct: neg, color: '#e5806b' },
    ];

    const findings = report.key_points || [];

    // 출처: url 기준 중복 제거 (백엔드가 청크 단위라 같은 기사가 중복됨)
    const seen = new Set<string>();
    const sources: AnalysisSource[] = [];
    for (const src of report.sources || []) {
      if (!seen.has(src.url)) {
        seen.add(src.url);
        sources.push(src);
      }
    }

    return (
      <div className={styles.reportWrap}>
        <div className={styles.reportHead}>
          <div className={styles.reportKicker}>
            <span className={styles.kickerLabel}>AI 분석 리포트</span>
            <span className={styles.kickerDot} />
            <span className={styles.kickerTime}>
              {report.generated_at ? new Date(report.generated_at).toLocaleString('ko-KR') : '방금'}
            </span>
          </div>
          <h1 className={styles.reportTitle}>{reportMeta.topic}</h1>
          <div className={styles.reportTags}>
            <span className={`${styles.tag} ${styles.tagAccent}`}>{pName} 관점</span>
            <span className={styles.tag}>{depthName} 분석</span>
            <span className={styles.tag}>기사 {report.articles_analyzed}개</span>
          </div>
        </div>

        {report.sentiment && (
          <div className={styles.sentimentCard}>
            <span className={styles.cardTitle}>보도 감성 분포</span>
            <div className={styles.sentimentBar}>
              {dist.map((d) => (
                d.pct > 0 ? <div key={d.label} style={{ width: `${d.pct}%`, background: d.color }} /> : null
              ))}
            </div>
            <div className={styles.sentimentLegend}>
              {dist.map((d) => (
                <div key={d.label} className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ background: d.color }} />
                  <span className={styles.legendLabel}>{d.label}</span>
                  <span className={styles.legendPct}>{d.pct}%</span>
                </div>
              ))}
            </div>
            <span className={styles.sentimentNote}>※ AI 종합 감성 점수({s.toFixed(2)}) 기준으로 환산한 값입니다.</span>
          </div>
        )}

        {findings.length > 0 && (
          <div className={styles.section}>
            <span className={styles.cardTitle}>핵심 포인트</span>
            {findings.map((f, i) => (
              <div key={i} className={styles.findingCard}>
                <span className={styles.findingNum}>{i + 1}</span>
                <span className={styles.findingText}>{f}</span>
              </div>
            ))}
          </div>
        )}

        {sources.length > 0 && (
          <div className={styles.section}>
            <span className={styles.cardTitle}>분석에 사용된 기사</span>
            <div className={styles.sourceList}>
              {sources.map((n, i) => (
                <a
                  key={n.url || i}
                  className={styles.sourceRow}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className={styles.sourceSrc}>{domainOf(n.url)}</span>
                  <span className={styles.sourceTitle}>{cleanTitle(n.title)}</span>
                  <span className={styles.sourceScore}>유사도 {Math.round((n.score ?? 0) * 100)}%</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className={styles.reportActions}>
          <button type="button" className={styles.actionGhost} onClick={reset}>새 분석 시작</button>
          <button type="button" className={styles.actionPrimary} onClick={saveReport}>리포트 저장</button>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        {screen === 'form' && renderForm()}
        {screen === 'loading' && renderLoading()}
        {screen === 'report' && renderReport()}
      </div>
    </div>
  );
}
