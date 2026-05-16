const { ArticleSentimentClassifier } = require('./src/services/articleSentimentClassifier');

(async () => {
  const classifier = new ArticleSentimentClassifier();

  if (!classifier._isOnnxAvailable()) {
    console.error('[test] ONNX model not found. Run ml/run.sh first.');
    process.exit(1);
  }

  const cases = [
    { expected: 'positive', title: '삼성전자 사상 최대 실적 달성, 영업이익 급증' },
    { expected: 'positive', title: '신제품 흥행 돌풍, 매진 사례 잇따라' },
    { expected: 'positive', title: 'BTS 신곡 빌보드 1위 등극, K팝 신기록' },
    { expected: 'positive', title: '국내 스타트업, 글로벌 투자 유치 성공' },
    { expected: 'positive', title: '월드컵 16강 진출, 국민 환호' },
    { expected: 'negative', title: '아동 사망사고로 리콜 결정, 안전성 논란 확산' },
    { expected: 'negative', title: '폭발 사고로 인근 주민 대피, 화재 진압 중' },
    { expected: 'negative', title: '대기업 회장 횡령 혐의 구속, 검찰 수사 확대' },
    { expected: 'negative', title: '상장사 분기 영업적자 전환, 주가 급락' },
    { expected: 'negative', title: '전기차 배터리 결함 발견, 대규모 리콜' },
    { expected: 'neutral', title: '한국은행 기준금리 동결, 시장 전망 엇갈려' },
    { expected: 'neutral', title: '국토부, 부동산 정책 발표 예정' },
    { expected: 'neutral', title: '주요 투자자, 일부 지분 매도 공시' },
    { expected: 'neutral', title: '환율 1300원대 등락, 보합권 마감' },
    { expected: 'neutral', title: '내일 전국에 비, 기온 변화 주의' },
  ];

  console.log('[test] Loading ONNX pipeline...');
  const t0 = Date.now();
  const results = await classifier._classifyWithOnnxModel(cases.map(c => ({ title: c.title })));
  const elapsed = Date.now() - t0;

  console.log(`[test] Inference completed in ${elapsed}ms (${(elapsed / cases.length).toFixed(0)}ms/article)`);
  console.log('---');

  let correct = 0;
  const wrong = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = results[i];
    const ok = r.sentiment === c.expected;
    if (ok) correct++; else wrong.push({ expected: c.expected, got: r.sentiment, title: c.title });
    const mark = ok ? 'OK ' : 'X  ';
    console.log(`${mark} expected=${c.expected.padEnd(8)} got=${r.sentiment.padEnd(8)} (${String(r.sentimentScore).padStart(3)}%) ${c.title}`);
  }

  console.log('---');
  console.log(`Accuracy: ${correct}/${cases.length} (${((correct / cases.length) * 100).toFixed(1)}%)`);

  if (wrong.length > 0) {
    console.log('\nMisclassified:');
    for (const w of wrong) {
      console.log(`  expected=${w.expected} got=${w.got} | ${w.title}`);
    }
  }
})().catch(err => {
  console.error('[test] Error:', err);
  process.exit(1);
});
