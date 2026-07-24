import { ImageResponse } from 'next/og';

// 카카오톡·페이스북·슬랙 등 링크 미리보기용 썸네일(1200x630)을 동적으로 생성한다.
export const runtime = 'edge';
export const alt = '뉴스봇 · 나의 뉴스 비서';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Satori(next/og)는 woff2를 못 읽으므로, 구형 User-Agent로 요청해 TTF를 받아온다.
// &text= 로 실제 사용하는 글자만 서브셋 받아 다운로드를 가볍게 한다.
async function loadKoreanFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const api =
      'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@800&display=swap&text=' +
      encodeURIComponent(text);
    const css = await fetch(api, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:6.0) Gecko/20110814 Firefox/6.0',
      },
    }).then((res) => res.text());
    const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!url) return null;
    return await fetch(url).then((res) => res.arrayBuffer());
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const glyphs =
    '뉴스봇나의비서실시간인기키워드기사감성분석한눈에보는 ·mynews-cvercel.app';
  const fontData = await loadKoreanFont(glyphs);
  const hasKR = !!fontData;

  const title = hasKR ? '뉴스봇' : 'NEWSBOT';
  const tagline = hasKR ? '나의 뉴스 비서' : 'Your personal news assistant';
  const badge = hasKR ? '실시간 인기 키워드 · 감성 분석' : 'Trending · Sentiment analysis';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '96px',
          position: 'relative',
          color: '#f1f5f9',
          fontFamily: hasKR ? 'Noto Sans KR' : 'sans-serif',
          backgroundColor: '#12161a',
          backgroundImage:
            'linear-gradient(135deg, #0e1418 0%, #12161a 55%, #0b0f12 100%)',
        }}
      >
        {/* 좌상단 그린 글로우 */}
        <div
          style={{
            position: 'absolute',
            top: '-180px',
            left: '-140px',
            width: '760px',
            height: '760px',
            borderRadius: '50%',
            display: 'flex',
            backgroundImage:
              'radial-gradient(circle, rgba(122,184,157,0.34) 0%, rgba(122,184,157,0.0) 70%)',
          }}
        />
        {/* 상단: 로고 마크 + 서비스 성격 라벨 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          <div
            style={{
              width: '104px',
              height: '104px',
              borderRadius: '26px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: '12px',
              padding: '26px',
              backgroundImage: 'linear-gradient(135deg, #7ab89d 0%, #5fa383 100%)',
              boxShadow: '0 20px 60px rgba(122,184,157,0.35)',
            }}
          >
            <div style={{ height: '10px', width: '100%', borderRadius: '6px', backgroundColor: '#ffffff' }} />
            <div style={{ height: '10px', width: '74%', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.85)' }} />
            <div style={{ height: '10px', width: '90%', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.7)' }} />
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: '30px',
              fontWeight: 800,
              letterSpacing: '2px',
              color: '#9fd3c7',
            }}
          >
            {badge}
          </div>
        </div>

        {/* 중앙: 서비스명 + 태그라인 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              fontSize: '168px',
              fontWeight: 800,
              letterSpacing: '-6px',
              lineHeight: 1,
            }}
          >
            {title}
          </div>
          <div style={{ display: 'flex', fontSize: '58px', fontWeight: 800, color: '#9fd3c7' }}>
            {tagline}
          </div>
        </div>

        {/* 하단: 도메인 */}
        <div style={{ display: 'flex', fontSize: '34px', color: 'rgba(241,245,249,0.55)' }}>
          mynews-c.vercel.app
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fontData
        ? [{ name: 'Noto Sans KR', data: fontData, weight: 800, style: 'normal' }]
        : [],
    }
  );
}
