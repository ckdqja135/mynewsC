/**
 * 검색어 부적절 단어(욕설/비속어) 필터
 *
 * 목적: 뉴스 검색창에 순수 욕설·비속어를 넣는 것을 차단한다.
 * 주의: 뉴스에서 정당하게 다루는 민감 주제(살인·마약·성범죄·전쟁 등)는 차단하지 않는다.
 *       이 필터의 대상은 "검색 의도가 없는 욕설/비속어"뿐이다.
 *
 * 오탐 방지:
 *  - 정규화 시 공백·특수문자를 제거해 우회(ㅅ.ㅂ, 씨 발)를 잡되,
 *  - 문법상 우연히 겹치는 표현(시발점, 보지 못한, 안 자지)은 애매한 단일어를 목록에서 빼고
 *    ALLOWLIST(예: 시발점)로 예외 처리한다.
 *
 * 확장(코드 수정 없이 .env로):
 *   BLOCKED_SEARCH_TERMS=단어1,단어2   (차단어 추가)
 *   ALLOWED_SEARCH_TERMS=시발점,시발역  (예외 추가)
 */

// 기본 차단어 (욕설/비속어 위주 · 뉴스 주제어와 무관한 것들)
// 문법상 오탐이 큰 단일어(보지/자지/씹 등 단독)는 의도적으로 제외하고 합성형만 포함.
const DEFAULT_BLOCKLIST = [
  '씨발', '시발', '씨빨', '시팔', '씨팔', '쓰발', 'ㅅㅂ', 'ㅆㅂ',
  '개새끼', '개색끼', '개세끼', '개새기', '개자식', '개놈', '개년',
  '병신', 'ㅄ', 'ㅂㅅ', '지랄', 'ㅈㄹ', '좆', '좆같', '좆까', '좆도',
  '존나', 'ㅈㄴ', '니미', '니애미', '씨발년', '씨발놈', '미친놈', '미친년',
  '창녀', '걸레년', '썅년', '씹창', '씹새끼', '후레자식', '느금마', '느개비',
  'fuck', 'fucking', 'shit', 'bitch', 'asshole',
];

// 예외(오탐 방지) — 차단어 조각을 포함하지만 정상적인 표현
const DEFAULT_ALLOWLIST = [
  '시발점', '시발역', '시발자', '시발용', '시발성', '시발지', // 始發*
];

function _fromEnv(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// 검색어 정규화: 소문자화 + 공백/특수문자 제거(우회 방지). 한글·자모·영숫자만 남긴다.
function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
}

const BLOCKLIST = [...new Set([...DEFAULT_BLOCKLIST, ..._fromEnv('BLOCKED_SEARCH_TERMS')])]
  .map(normalize)
  .filter(Boolean);
const ALLOWLIST = [...new Set([...DEFAULT_ALLOWLIST, ..._fromEnv('ALLOWED_SEARCH_TERMS')])]
  .map(normalize)
  .filter(Boolean);

/**
 * 검색어에 부적절 단어가 포함됐는지 검사한다.
 * @param {string} query
 * @returns {{ blocked: boolean, matched: string|null }}
 */
function checkSearchQuery(query) {
  let n = normalize(query);
  if (!n) return { blocked: false, matched: null };

  // 예외 표현(시발점 등)을 먼저 제거한 뒤 검사 → 오탐 방지
  for (const safe of ALLOWLIST) {
    if (safe) n = n.split(safe).join('');
  }

  for (const bad of BLOCKLIST) {
    if (bad && n.includes(bad)) {
      return { blocked: true, matched: bad };
    }
  }
  return { blocked: false, matched: null };
}

module.exports = { checkSearchQuery, normalize };
