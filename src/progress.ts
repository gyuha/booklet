// 읽기 진행률 인디게이터 갱신.
//
// **왜 별도 모듈인가:** 인디게이터는 앱 크롬(`index.html` + `main.ts`)이지만
// C3(Playwright)·C8(WKWebView)은 `check.html` 을 로드하므로 앱의 DOM 을 볼 수 없다.
// 두 곳이 이 함수를 함께 쓰면 체크가 하네스 대역이 아니라 **실물 코드**를 검증한다.
// (`fonts.ts` 가 같은 이유로 분리돼 있다.) 두 줄짜리 로직을 위한 추상화가 아니다.
//
// 진행률은 **페이지 번호가 아니다** — 재유동 epub 에는 고정된 페이지 수가 없다.
// `.forge/CONTEXT.md` 의 "읽기 진행률" 참조.

/**
 * `fraction`(0..1, 책 전체 기준)을 바 폭과 퍼센트 텍스트에 적용한다.
 *
 * 폭도 텍스트도 **같은 반올림 정수**를 쓴다 — 둘이 어긋나면 눈에도 걸리고
 * "바 폭과 텍스트가 일치한다"는 단언도 세울 수 없다.
 *
 * `fraction` 이 없는 relocate 도 있으므로(섹션 로드 도중) 0 으로 떨어뜨린다.
 */
export function renderProgress(
  fill: HTMLElement,
  pct: HTMLElement,
  fraction: number | undefined,
): void {
  const clamped = Math.min(1, Math.max(0, fraction ?? 0));
  const percent = Math.round(clamped * 100);
  fill.style.width = `${percent}%`;
  pct.textContent = `${percent}%`;
}
