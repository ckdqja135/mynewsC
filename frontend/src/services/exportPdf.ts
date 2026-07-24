// 리포트 DOM을 한 번의 클릭으로 PDF 파일로 저장하는 "스냅샷형" 내보내기.
// shop-admin-front의 exportElementToPdf 패턴을 따름: html2canvas-pro로 DOM→canvas 캡처 후
// jsPDF에 JPEG(0.92) 이미지로 심어 저장. (텍스트 선택/검색이 안 되는 이미지 기반)
//
// 차이점: 그쪽은 대시보드라 카드 1개=A4 1장(fit-to-page)이지만, 뉴스 리포트는 세로로 긴
// 흐름 문서라 한 장에 욱여넣으면 글자가 작아진다. 그래서 페이지 높이만큼 잘라 여러 장에 나눈다.
//
// 캡처에서 제외할 요소에는 className "pdf-hide" 또는 [data-print-hide]를 붙인다.
// (무거운 라이브러리이므로 클릭 시점에만 동적 import → 초기 번들 미포함)
export async function exportElementToPdf(
  element: HTMLElement | null,
  fileName: string,
): Promise<void> {
  if (!element || typeof window === 'undefined') return;

  const [{ jsPDF }, html2canvasMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas-pro'),
  ]);
  const html2canvas = html2canvasMod.default;

  // 캡처 배경: 현재 테마에 맞춰 (다크에서 흰 배경이 새어 나오지 않게)
  const theme = document.documentElement.getAttribute('data-theme');
  const backgroundColor = theme === 'dark' ? '#15171b' : '#ffffff';

  const canvas = await html2canvas(element, {
    scale: 2, // 글자 선명도 확보 (1이면 흐릿함)
    backgroundColor,
    useCORS: true,
    ignoreElements: (node) =>
      node instanceof HTMLElement &&
      (node.classList.contains('pdf-hide') || node.hasAttribute('data-print-hide')),
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth(); // 210
  const pageH = pdf.internal.pageSize.getHeight(); // 297
  const margin = 8; // 좌우 여백(mm)
  const imgW = pageW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  // 세로로 긴 리포트: 페이지 높이만큼 잘라가며 여러 장에 심는다. (세로 여백 없이 풀-슬라이스)
  let heightLeft = imgH;
  let position = 0;
  pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
    heightLeft -= pageH;
  }

  pdf.save(`${fileName}.pdf`);
}
