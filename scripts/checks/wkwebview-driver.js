// C8 드라이버 — WKWebView 안에서 실행된다. callAsyncJavaScript 로 호출되므로
// 최상위 await 를 쓸 수 있고, 반환한 JSON 문자열이 그대로 네이티브로 넘어간다.
//
// 관측 범위: 주로 **메인 프레임에서 보이는 것**을 검증한다 —
// 목차 파싱 · CFI 생성 · 페이지 넘김 · 섹션 이동 · 두 번째 책 교체.
// 본문 텍스트 단언은 여전히 Chromium 의 C3 담당이다.
//
// 다만 "본문 iframe 에 전혀 접근할 수 없다" 는 것은 사실이 아니다(전에 그렇게 적어 뒀다).
// shadow root 는 mode:'closed' 이지만 `foliate-view.renderer.getContents()` 는 요소의
// 공개 프로퍼티라서 섹션 문서에 닿는다 — 아래 3b 가 WKWebView 에서 실제로 그렇게 읽는다
// (`fontSections: "loaded"` 로 확인). 그래도 관측 실패와 검증 실패는 구분해서 다룬다.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, ms = 40000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  return null;
}

// 모듈 스크립트 평가가 didFinish 뒤로 밀릴 수 있으므로 폴링한다.
const c = await poll(() => window.check, 15000);
if (!c)
  throw new Error(
    "window.check 가 15초 안에 나타나지 않았다 — check.html 의 모듈 스크립트가 실행되지 않았다",
  );

const cfi = () => c.locations.at(-1)?.cfi ?? null;
const changedFrom = (prev) =>
  poll(() => {
    const x = cfi();
    return x && x !== prev ? x : null;
  });
const labels = () => c.toc().map((i) => `${i.label}|${i.href}`);

// 1. 첫 번째 책
await c.openUrl("/fixtures/a.epub");
if (!(await poll(() => c.openCount >= 1))) throw new Error("책 A 오픈 실패");

// 2. 목차 파싱
const tocA = labels();
if (tocA.length < 2) throw new Error(`목차 항목이 2개 미만: ${tocA.length}`);

// 3. 렌더 파이프라인이 실제로 돌았는가 (표지 페이지라 텍스트는 없을 수 있다)
const cfi1 = await poll(() => cfi());
if (!cfi1 || !cfi1.includes("epubcfi("))
  throw new Error(`CFI 가 생성되지 않았다: ${cfi1}`);

// 3b. 번들한 기본 본문 글꼴이 WKWebView 에서도 로드되는가.
//     이미지 넘침 회귀가 WKWebView 에서만 재현된 전례가 있어 Chromium 통과를 근거로
//     건너뛰지 않는다. 관측 한계와 실제 실패는 구분한다 —
//     섹션 문서에 닿지 못하면(`unreachable: …`) 최상위 로드 결과만으로 판정한다.
const font = await c.bundledFont();
if (font.mainStatus !== "loaded")
  throw new Error(
    `번들 글꼴을 최상위 프레임에서 로드하지 못했다 (${font.mainStatus}) — src=${font.src}`,
  );
if (Array.isArray(font.sections)) {
  if (font.sections.length === 0)
    throw new Error("섹션 문서를 하나도 얻지 못했다 — getContents() 가 비었다");
  for (const s of font.sections) {
    if (s.face !== "loaded")
      throw new Error(`섹션 문서에서 번들 글꼴이 로드되지 않았다 (status=${s.face})`);
    if (!s.bodyFamily.includes(font.family))
      throw new Error(
        `섹션 본문이 번들 글꼴로 렌더되지 않았다 (font-family=${s.bodyFamily})`,
      );
  }
}

// 4. 페이지 넘김
c.reader.goRight();
const cfi2 = await changedFrom(cfi1);
if (!cfi2) throw new Error("goRight() 후에도 CFI 가 변하지 않았다");

// 5. 다른 섹션으로 이동
const base = (h) => h.split("#")[0];
const first = c.toc()[0];
const other = c.toc().find((i) => base(i.href) !== base(first.href));
if (!other) throw new Error("비교할 다른 섹션을 찾지 못했다");
await c.reader.goTo(other.href);
const cfi3 = await changedFrom(cfi2);
if (!cfi3) throw new Error("섹션 이동 후에도 CFI 가 변하지 않았다");

// 6. 두 번째 책으로 교체 (view.close() 누락 회귀를 WKWebView 에서 확인)
await c.openUrl("/fixtures/b.epub");
if (!(await poll(() => c.openCount >= 2))) throw new Error("책 B 오픈 실패");

const tocB = labels();
if (tocB.length < 2) throw new Error(`책 B 목차가 비었다: ${tocB.length}`);
if (JSON.stringify(tocB) === JSON.stringify(tocA))
  throw new Error("두 번째 책을 열었는데 목차가 그대로다");

const cfi4 = await changedFrom(cfi3);
if (!cfi4) throw new Error("책 B 에서 CFI 가 생성되지 않았다");

return JSON.stringify({
  ua: navigator.userAgent,
  constructableStyleSheets:
    typeof CSSStyleSheet !== "undefined" &&
    "replaceSync" in CSSStyleSheet.prototype,
  tocA: tocA.length,
  tocB: tocB.length,
  // 번들 글꼴: 최상위 로드 상태와, 섹션 관측이 가능했는지 여부까지 남긴다.
  fontMainStatus: font.mainStatus,
  fontSections: Array.isArray(font.sections)
    ? font.sections.map((s) => s.face).join(",")
    : font.sections,
  cfi1,
  cfi2,
  cfi3,
  cfi4,
});
