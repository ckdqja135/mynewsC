import type { SentimentType } from '@/types/news';

// 감성 표시 관련 단일 소스(SSOT).
// 라벨/이모지/색상이 여러 화면에 흩어져 하드코딩되던 것을 여기로 모은다.

// 감성 타입 순서 (긍정 → 부정 → 중립)
export const SENTIMENT_TYPES: SentimentType[] = ['positive', 'negative', 'neutral'];

// 감성별 표시 메타
export const SENTIMENT_META: Record<SentimentType, { label: string; emoji: string; color: string }> = {
  positive: { label: '긍정', emoji: '🟢', color: '#4caf50' },
  negative: { label: '부정', emoji: '🔴', color: '#f44336' },
  neutral: { label: '중립', emoji: '🟡', color: '#ff9800' },
};

const normalize = (s: string | null | undefined): SentimentType | null => {
  const k = (s || '').toLowerCase();
  return k === 'positive' || k === 'negative' || k === 'neutral' ? (k as SentimentType) : null;
};

export const sentimentEmoji = (s: string | null | undefined): string => {
  const k = normalize(s);
  return k ? SENTIMENT_META[k].emoji : '⚪';
};

export const sentimentLabel = (s: string | null | undefined): string => {
  const k = normalize(s);
  return k ? SENTIMENT_META[k].label : '기타';
};

// "🟢 긍정" 형태의 배지 텍스트
export const sentimentBadge = (s: string | null | undefined): string => {
  const k = normalize(s);
  return k ? `${SENTIMENT_META[k].emoji} ${SENTIMENT_META[k].label}` : '⚪ 기타';
};
