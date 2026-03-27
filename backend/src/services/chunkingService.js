const TARGET_CHUNK_SIZE = 400; // 목표 청크 크기 (chars)
const OVERLAP_SIZE = 80;       // 이전 청크와 겹치는 크기
const MIN_CHUNK_SIZE = 80;     // 최소 청크 크기

/**
 * 텍스트를 청크 배열로 분할합니다.
 * - 문단(\n\n) 기준 우선 분할
 * - 문단 구분 없으면 문장 기준 분할
 * - 각 청크는 이전 청크의 끝 일부를 overlap으로 포함
 *
 * @param {string} text - 정제된 본문 텍스트
 * @param {string} articleId - 원본 기사 ID (청크 ID 생성용)
 * @returns {Array<{chunkId, articleId, chunkIndex, text}>}
 */
function chunkText(text, articleId) {
  if (!text || text.length < MIN_CHUNK_SIZE) return [];

  const paragraphs = text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length >= MIN_CHUNK_SIZE);

  if (paragraphs.length === 0) {
    return _chunkBySentences(text, articleId);
  }

  const chunks = [];
  let buffer = '';
  let prevTail = '';
  let chunkIndex = 0;

  for (const para of paragraphs) {
    if (buffer.length > 0 && buffer.length + para.length > TARGET_CHUNK_SIZE) {
      // 현재 버퍼를 청크로 저장
      const chunkContent = prevTail ? `${prevTail}\n\n${buffer}` : buffer;
      chunks.push({
        chunkId: `${articleId}_${chunkIndex}`,
        articleId,
        chunkIndex,
        text: chunkContent.trim(),
      });
      chunkIndex++;
      prevTail = buffer.slice(-OVERLAP_SIZE);
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }

  // 마지막 남은 버퍼
  if (buffer.length >= MIN_CHUNK_SIZE) {
    const chunkContent = prevTail ? `${prevTail}\n\n${buffer}` : buffer;
    chunks.push({
      chunkId: `${articleId}_${chunkIndex}`,
      articleId,
      chunkIndex,
      text: chunkContent.trim(),
    });
  }

  return chunks;
}

/**
 * 문단 구분이 없는 텍스트를 문장 단위로 분할합니다.
 */
function _chunkBySentences(text, articleId) {
  const sentences = text.match(/[^.!?。\n]+[.!?。\n]+/g) || [text];
  const chunks = [];
  let buffer = '';
  let chunkIndex = 0;

  for (const sentence of sentences) {
    if (buffer.length + sentence.length > TARGET_CHUNK_SIZE && buffer.length >= MIN_CHUNK_SIZE) {
      chunks.push({
        chunkId: `${articleId}_${chunkIndex}`,
        articleId,
        chunkIndex,
        text: buffer.trim(),
      });
      chunkIndex++;
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  }

  if (buffer.length >= MIN_CHUNK_SIZE) {
    chunks.push({
      chunkId: `${articleId}_${chunkIndex}`,
      articleId,
      chunkIndex,
      text: buffer.trim(),
    });
  }

  return chunks;
}

module.exports = { chunkText };
