// 본문 글꼴 후보와 가용성 감지. Tauri API 를 쓰지 않으므로 브라우저에서 그대로 검증된다.
//
// 이 머신에만 3,024개 폰트 패밀리가 있어 전수 열거는 UI 로 쓸 수 없고, 한글 지원 여부를
// 걸러내려면 네이티브 글리프 검사가 필요하다. 그래서 **엄선 후보 + 런타임 가용성 필터**를
// 택했다 (계획 참조).
//
// **예외가 하나 있다: 기본 본문 글꼴(리디바탕)은 앱에 번들해 나간다.** 기본값이 설치 여부에
// 따라 조용히 폴백되면 애초에 기본값이 아니기 때문이다. woff2 로 447KB 라 "웹폰트 번들은
// 앱을 부풀린다" 는 원래 근거가 이 글꼴에는 거의 적용되지 않았다. 두 번째 글꼴을 번들하려
// 한다면 그 저울질을 다시 해야 한다 — ADR 260730-001332 를 읽어라.

export type FontOption = {
  label: string;
  /** null = 미설정 → 번들한 기본 본문 글꼴. "epub 자체 지정 존중" 이 아니다. */
  family: string | null;
};

/**
 * 후보. `families` 는 별칭 목록이며 **먼저 사용 가능한 것**을 쓴다 —
 * macOS 는 폰트를 로컬라이즈된 이름(`본고딕 KR`)으로도, 영문명으로도 노출해서
 * 어느 쪽이 CSS 에서 먹는지 단정할 수 없다. 별칭을 나열하면 추측이 필요 없다.
 */
const CANDIDATES: { label: string; families: string[] }[] = [
  { label: "Apple SD 산돌고딕 Neo", families: ["Apple SD Gothic Neo", "Apple SD 산돌고딕 Neo"] },
  { label: "Pretendard", families: ["Pretendard", "Pretendard Std"] },
  { label: "본고딕", families: ["본고딕 KR", "Source Han Sans KR", "Noto Sans KR"] },
  { label: "Spoqa Han Sans Neo", families: ["Spoqa Han Sans Neo"] },
  { label: "나눔바른고딕", families: ["나눔바른고딕", "NanumBarunGothic"] },
  { label: "명조 (AppleMyungjo)", families: ["AppleMyungjo", "Apple Myungjo"] },
];

// 한글만으로 된 샘플을 쓰는 것이 핵심이다. 미설치 폰트는 물론이고
// **설치돼 있으나 한글 글리프가 없는 폰트도** 폴백으로 렌더되어 폭이 같아지므로
// 한 번에 걸러진다. 라틴 문자를 섞으면 이 효과가 사라진다.
const SAMPLE = "가나다라마바사아자차";
const PROBE_SIZE = "72px";
// 폴백을 둘 쓰는 이유: 후보가 우연히 한쪽 폴백과 폭이 같을 때의 오탐을 줄인다.
const FALLBACKS = ["monospace", "serif"];

/** 캔버스 텍스트 폭 비교로 판정한다. 네이티브 API 없음. */
export function isFontAvailable(family: string): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return false;

  return FALLBACKS.some((fallback) => {
    ctx.font = `${PROBE_SIZE} ${fallback}`;
    const base = ctx.measureText(SAMPLE).width;
    ctx.font = `${PROBE_SIZE} "${family}", ${fallback}`;
    const candidate = ctx.measureText(SAMPLE).width;
    // 폴백과 폭이 다르면 후보가 실제로 적용된 것이다.
    return Math.abs(candidate - base) > 0.5;
  });
}

/** 설치된 후보만 남긴 목록. 맨 앞은 언제나 번들한 기본 본문 글꼴. */
export function availableFonts(): FontOption[] {
  // 첫 항목은 나머지와 성격이 다르다: **가용성 필터를 타지 않는다.** 앱에 함께 담겨
  // 나가므로 시스템 설치 여부와 무관하게 언제나 쓸 수 있다.
  const options: FontOption[] = [{ label: "리디바탕", family: null }];
  for (const { label, families } of CANDIDATES) {
    const found = families.find(isFontAvailable);
    if (found) options.push({ label, family: found });
  }
  return options;
}
