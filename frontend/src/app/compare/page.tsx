'use client';

import { useState, useEffect, useRef } from 'react';
import { NewsApiService } from '@/services/newsApi';
import { exportElementToPdf } from '@/services/exportPdf';
import type { NewsAnalysisResponse, AnalysisType } from '@/types/news';
import styles from './compare.module.css';

const PERSPECTIVES: { key: AnalysisType; name: string }[] = [
  { key: 'comprehensive', name: '종합' },
  { key: 'sentiment', name: '논조' },
  { key: 'key_points', name: '쟁점' },
  { key: 'trend', name: '트렌드' },
];

const DEPTHS: { name: string; sub: string; num: number }[] = [
  { name: '빠르게', sub: '기사 30개', num: 30 },
  { name: '표준', sub: '기사 100개', num: 100 },
];

// 보도 감성 팔레트 (앱 전역 리포트와 동일 — diverging 초록/코럴 + 중립 회색)
const SENT = { pos: '#4e9d7c', neu: '#c4c9ce', neg: '#e5806b' };

type Screen = 'form' | 'loading' | 'report';

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e || '');
  if (/부적절|금지어|blocked/i.test(msg)) {
    return '부적절한 검색어예요. 다른 키워드로 시도해 주세요.';
  }
  if (/No response from server|connection|network|연결/i.test(msg)) {
    return '서버에 연결하지 못했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.';
  }
  if (/No articles found|찾지|404/i.test(msg)) {
    return '두 주제 중 하나의 최신 기사를 찾지 못했어요. 다른 키워드로 시도해 보세요.';
  }
  if (/rate|한도|429|queue/i.test(msg)) {
    return 'AI 분석 요청이 잠시 몰렸어요. 잠깐 뒤에 다시 시도해 주세요.';
  }
  return 'AI 비교 분석에 일시적으로 실패했어요. 잠시 후 다시 시도하거나, 분석 깊이를 낮춰 보세요.';
}

// 감성 점수(-1~1)를 pos/neu/neg 3구간(%)으로 환산
function sentimentDist(report: NewsAnalysisResponse | null) {
  const s = Math.max(-1, Math.min(1, report?.sentiment?.sentiment_score ?? 0));
  const pos = Math.round(Math.max(0, s) * 100);
  const neg = Math.round(Math.max(0, -s) * 100);
  const neu = Math.max(0, 100 - pos - neg);
  return { s, pos, neu, neg };
}

// 핵심 포인트의 [참고 N] 마커 제거 (비교 화면에선 근거 이동 UI가 없으므로 텍스트만)
function stripCite(text: string): string {
  return (text || '').replace(/\[참고\s*\d+\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

export default function ComparePage() {
  const [topicA, setTopicA] = useState('');
  const [topicB, setTopicB] = useState('');
  const [persp, setPersp] = useState(0);
  const [depth, setDepth] = useState(0);
  const [screen, setScreen] = useState<Screen>('form');
  const [reportA, setReportA] = useState<NewsAnalysisResponse | null>(null);
  const [reportB, setReportB] = useState<NewsAnalysisResponse | null>(null);
  const [error, setError] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const runningRef = useRef(false);
  const autoRanRef = useRef(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const runCompare = async (a: string, b: string, perspIdx: number, depthIdx: number) => {
    if (runningRef.current) return;
    const ta = (a || '').trim();
    const tb = (b || '').trim();
    if (!ta || !tb) {
      setError('비교할 두 주제를 모두 입력해주세요');
      return;
    }
    if (ta === tb) {
      setError('서로 다른 두 주제를 입력해주세요');
      return;
    }
    runningRef.current = true;
    setError('');
    setScreen('loading');

    try {
      const req = (q: string) =>
        NewsApiService.analyzeNews({
          q,
          hl: 'ko',
          gl: 'kr',
          num: DEPTHS[depthIdx].num,
          analysis_type: PERSPECTIVES[perspIdx].key,
        });
      // 두 주제를 동시에 분석
      const [rA, rB] = await Promise.all([req(ta), req(tb)]);
      setReportA(rA);
      setReportB(rB);
      setScreen('report');
    } catch (e) {
      console.error('[주제비교] 분석 실패:', e); // 원본 에러는 콘솔에만
      setError(friendlyError(e));
      setScreen('form');
    } finally {
      runningRef.current = false;
    }
  };

  const run = () => runCompare(topicA, topicB, persp, depth);

  // 공유 링크(/compare?a=…&b=…&type=…&depth=…)로 진입하면 자동으로 비교를 실행한다.
  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    try {
      const sp = new URLSearchParams(window.location.search);
      const a = (sp.get('a') || '').trim();
      const b = (sp.get('b') || '').trim();
      if (!a || !b) return;
      const pi = PERSPECTIVES.findIndex((p) => p.key === sp.get('type'));
      const perspIdx = pi >= 0 ? pi : 0;
      const dRaw = parseInt(sp.get('depth') || '', 10);
      const depthIdx = Number.isInteger(dRaw) && dRaw >= 0 && dRaw < DEPTHS.length ? dRaw : 0;
      setTopicA(a);
      setTopicB(b);
      setPersp(perspIdx);
      setDepth(depthIdx);
      runCompare(a, b, perspIdx, depthIdx);
    } catch {
      /* 무시 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildShareUrl = (): string => {
    const sp = new URLSearchParams({
      a: topicA.trim(),
      b: topicB.trim(),
      type: PERSPECTIVES[persp].key,
      depth: String(depth),
    });
    return `${window.location.origin}/compare?${sp.toString()}`;
  };

  const shareCompare = async () => {
    const url = buildShareUrl();
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${topicA} vs ${topicB} · 뉴스 비교`, url });
      } catch {
        /* 취소/실패 무시 */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg('링크를 복사했어요 📋');
    } catch {
      setShareMsg('복사에 실패했어요. 주소창 URL을 사용하세요');
    }
    window.setTimeout(() => setShareMsg(''), 2500);
  };

  const reset = () => {
    setScreen('form');
    setReportA(null);
    setReportB(null);
    setError('');
  };

  // PDF 저장: 비교 리포트 화면을 캡처해 원클릭으로 PDF 파일로 다운로드
  const downloadPdf = async () => {
    if (!reportRef.current || pdfBusy) return;
    setPdfBusy(true);
    try {
      await exportElementToPdf(reportRef.current, `주제비교-${topicA}-vs-${topicB}`);
    } catch (e) {
      console.error('[PDF] 생성 실패:', e);
      setShareMsg('PDF 생성에 실패했어요. 다시 시도해 주세요');
      window.setTimeout(() => setShareMsg(''), 2500);
    } finally {
      setPdfBusy(false);
    }
  };

  // ── 폼 ──
  const renderForm = () => (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>주제 비교</h1>
        <p className={styles.pageSub}>두 주제의 뉴스를 AI로 분석해 나란히 비교합니다</p>
      </div>

      {error && <div className={styles.errorBanner}>❌ {error}</div>}

      <div className={styles.formCard}>
        <div className={styles.vsRow}>
          <input
            className={styles.topicInput}
            value={topicA}
            onChange={(e) => setTopicA(e.target.value)}
            placeholder="첫 번째 주제 (예: 삼성전자)"
            aria-label="첫 번째 주제"
          />
          <span className={styles.vsBadge}>VS</span>
          <input
            className={styles.topicInput}
            value={topicB}
            onChange={(e) => setTopicB(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder="두 번째 주제 (예: LG전자)"
            aria-label="두 번째 주제"
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabelSm}>분석 관점</span>
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
          <span className={styles.fieldLabelSm}>분석 깊이</span>
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
                <span className={styles.optionSub}>{d.sub}</span>
              </button>
            ))}
          </div>
        </div>

        <p className={styles.hint}>※ 두 주제를 각각 분석하므로 단일 분석보다 시간이 더 걸려요.</p>
        <button type="button" className={styles.ctaButton} onClick={run}>비교 분석 시작</button>
      </div>
    </>
  );

  // ── 로딩 ──
  const renderLoading = () => (
    <div className={styles.loadingWrap}>
      <div className={styles.loadingSpinner} />
      <span className={styles.loadingTitle}>
        &lsquo;{topicA.trim()}&rsquo; vs &lsquo;{topicB.trim()}&rsquo; 비교 중
      </span>
      <span className={styles.loadingSub}>두 주제를 동시에 분석하고 있어요. 잠시만 기다려 주세요…</span>
    </div>
  );

  // ── 리포트 ──
  const renderReport = () => {
    if (!reportA || !reportB) return null;
    const dA = sentimentDist(reportA);
    const dB = sentimentDist(reportB);
    const delta = dA.s - dB.s;

    let verdict: string;
    if (Math.abs(delta) < 0.1) verdict = '두 주제의 보도 논조는 비슷한 편입니다.';
    else if (delta > 0) verdict = `‘${topicA}’ 보도가 ‘${topicB}’보다 더 긍정적입니다.`;
    else verdict = `‘${topicB}’ 보도가 ‘${topicA}’보다 더 긍정적입니다.`;

    const cols = [
      { topic: topicA, report: reportA, d: dA },
      { topic: topicB, report: reportB, d: dB },
    ];

    return (
      <div className={styles.reportWrap} data-print-root ref={reportRef}>
        <div className={styles.reportHead}>
          <span className={styles.kicker}>AI 주제 비교</span>
          <h1 className={styles.reportTitle}>
            {topicA} <span className={styles.vsInline}>vs</span> {topicB}
          </h1>
          <p className={styles.verdict}>{verdict}</p>
        </div>

        {/* 감성 점수 비교 — 공통 -1~1 축(diverging) */}
        <div className={styles.section}>
          <span className={styles.cardTitle}>보도 감성 점수</span>
          <div className={styles.divergeRows}>
            {cols.map((c) => (
              <div key={c.topic} className={styles.divergeRow}>
                <span className={styles.divergeLabel} title={c.topic}>{c.topic}</span>
                <div className={styles.divergeTrack}>
                  <span className={styles.divergeMid} />
                  <span
                    className={styles.divergeFill}
                    style={{
                      left: c.d.s >= 0 ? '50%' : `${50 + c.d.s * 50}%`,
                      width: `${Math.abs(c.d.s) * 50}%`,
                      background: c.d.s >= 0 ? SENT.pos : SENT.neg,
                    }}
                  />
                </div>
                <span className={styles.divergeVal}>{c.d.s > 0 ? '+' : ''}{c.d.s.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <span className={styles.axisNote}>← 부정 · 0(중립) · 긍정 →</span>
        </div>

        {/* 공통 감성 분포 범례 */}
        <div className={styles.sentLegend}>
          <span><i style={{ background: SENT.pos }} />긍정</span>
          <span><i style={{ background: SENT.neu }} />중립</span>
          <span><i style={{ background: SENT.neg }} />부정</span>
        </div>

        {/* 컬럼별 상세 비교 */}
        <div className={styles.compareGrid}>
          {cols.map((c) => (
            <div key={c.topic} className={styles.topicCard}>
              <div className={styles.topicCardHead}>{c.topic}</div>

              <div className={styles.statRow}>
                <div className={styles.stat}>
                  <span className={styles.statNum}>{c.report.articles_analyzed}</span>
                  <span className={styles.statLbl}>분석 기사</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statNum}>{c.d.s > 0 ? '+' : ''}{c.d.s.toFixed(2)}</span>
                  <span className={styles.statLbl}>감성 점수</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statNum}>{(c.report.key_points || []).length}</span>
                  <span className={styles.statLbl}>핵심 포인트</span>
                </div>
              </div>

              <div className={styles.sentBar} role="img" aria-label={`긍정 ${c.d.pos}%, 중립 ${c.d.neu}%, 부정 ${c.d.neg}%`}>
                {c.d.pos > 0 && <span style={{ width: `${c.d.pos}%`, background: SENT.pos }} />}
                {c.d.neu > 0 && <span style={{ width: `${c.d.neu}%`, background: SENT.neu }} />}
                {c.d.neg > 0 && <span style={{ width: `${c.d.neg}%`, background: SENT.neg }} />}
              </div>

              {c.report.summary && <p className={styles.summary}>{c.report.summary}</p>}

              {(c.report.key_points || []).length > 0 && (
                <ul className={styles.pointList}>
                  {(c.report.key_points || []).slice(0, 5).map((p, i) => (
                    <li key={i}>{stripCite(p)}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {shareMsg && <div className={styles.shareToast} data-print-hide>{shareMsg}</div>}
        <div className={styles.reportActions} data-print-hide>
          <button type="button" className={styles.actionGhost} onClick={reset}>새 비교</button>
          <button type="button" className={styles.actionGhost} onClick={shareCompare}>공유</button>
          <button type="button" className={styles.actionPrimary} onClick={downloadPdf} disabled={pdfBusy}>
            {pdfBusy ? 'PDF 생성 중…' : 'PDF 저장'}
          </button>
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
