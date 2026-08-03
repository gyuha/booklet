// foliate-js 렌더러 래퍼. Tauri API를 일절 쓰지 않는다 —
// 그래야 브라우저(Playwright)와 WKWebView 하네스에서 그대로 검증할 수 있다.
import "../vendor/foliate-js/view.js";
import bundledFontUrl from "./assets/RIDIBatang.woff2?url";

export type TocItem = {
  label: string;
  href: string | null;
  subitems?: TocItem[];
};

export type Location = {
  cfi?: string;
  fraction?: number;
};

/** 전역 타이포그래피 설정. 책의 속성이 아니라 읽는 사람의 속성이다. */
export type Typography = {
  /**
   * null = 미설정 → 기본 본문 글꼴({@link BUNDLED_FONT_FAMILY}).
   *
   * **"epub 자체 지정을 존중" 이라는 뜻이 아니다.** 본문에는 언제나 글꼴이 주입된다 —
   * 책 자체 글꼴을 그대로 보는 선택지는 이 앱에 없다(ADR 260730-001332).
   */
  fontFamily: string | null;
  fontScale: number;
  lineHeight: number;
  /** em 단위 */
  letterSpacing: number;
  /** px 단위, 본문 양쪽 여백 */
  margin: number;
  /**
   * 본문을 굵게.
   *
   * **단계가 아니라 on/off 인 것은 실측 결과다.** 번들 글꼴(리디바탕)은 웨이트가 하나뿐이라
   * 실제 굵기 변화는 엔진의 **합성 볼드**에서 나오는데, 실앱 엔진(WebKit)에서 재 보니
   * `100·300·400` 이 한 덩어리, `600·700·900` 이 한 덩어리로 **두 단계로만** 갈렸다
   * (잉크량 2,249,468 → 3,272,509 = +45%, 폭 609.28 → 627.06). 슬라이더를 놓으면 여섯 칸
   * 중 두 칸만 다른 컨트롤이 된다.
   */
  bold: boolean;
};

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: null,
  fontScale: 1,
  lineHeight: 1.7,
  letterSpacing: 0,
  margin: 48,
  bold: false,
};

// 글꼴을 강제하려면 epub 자체 CSS 를 이겨야 하므로 !important 가 필요하다.
// pre/code 는 목록에서 빼 등폭 글꼴을 지킨다(그 안의 div/span 까지는 못 막는다 — 감수).
const FONT_TARGETS =
  "html, body, p, li, blockquote, dd, dt, div, span, h1, h2, h3, h4, h5, h6, td, th, figcaption";

/**
 * 앱에 번들해 나가는 기본 본문 글꼴(리디바탕)의 `@font-face` 패밀리 이름.
 *
 * **일부러 설치된 글꼴과 겹치지 않는 이름을 쓴다.** `@font-face` 의 패밀리 이름은 우리가
 * 정하는 임의 레이블이므로 파일 내부 이름과 같을 필요가 없는데, 개발 머신에는 리디바탕이
 * 이미 설치돼 있어서 `리디바탕` 으로 선언하면 **번들 파일 로드가 실패해도 시스템 설치본이
 * `document.fonts.check()` 를 만족시켜 검증이 공허해진다.** 이 이름으로 렌더됐다는 것은
 * 번들 파일에서 왔다는 것 외에 다른 해석이 없다.
 *
 * 사용자에게 보이는 이름은 `fonts.ts` 의 `label`(리디바탕)이다.
 * 출처·라이선스는 `src/assets/RIDIBatang.LICENSE.md`, 번들 결정은 ADR 260730-001332.
 */
export const BUNDLED_FONT_FAMILY = "RIDIBatang Bundled";

/**
 * 번들 글꼴 파일의 **절대** URL.
 *
 * 섹션 문서는 blob: URL 이라 **상대 경로의 base 가 없다** — 절대 URL 로 만들어 넣어야 한다.
 * CORS 는 문제가 되지 않는다: blob: URL 은 생성 문서의 origin 을 상속하므로
 * 섹션 iframe 은 앱과 same-origin 이다 (paginator.js 가 iframe.src 에 blob URL 을 넣는다).
 */
export const BUNDLED_FONT_SRC = new URL(bundledFontUrl, location.href).href;

// 본문에 주입할 스타일. epub 자체 CSS를 덮어쓰지 않도록 최소한만 건드린다.
// html 의 font-size 를 배율로 잡으면 em/% 기반인 epub 본문이 함께 따라온다.
const bookCss = (t: Typography) => {
  // null = 미설정 → 번들한 기본 본문 글꼴. 본문에는 언제나 글꼴이 주입된다.
  const family = (t.fontFamily ?? BUNDLED_FONT_FAMILY).replace(/["\\]/g, "");
  return `
  @font-face {
    font-family: "${BUNDLED_FONT_FAMILY}";
    src: url("${BUNDLED_FONT_SRC}") format("woff2");
    font-display: block;
  }
  html {
    font-size: ${Math.round(t.fontScale * 100)}%;
    /* macOS 기본값(subpixel-antialiased)은 획을 눈에 띄게 두껍게 렌더한다 —
       "본문에 bold 가 걸린 것 같다" 는 인상의 원인이었다(실측으로 bold 는 없었다:
       body·p·html 전부 계산 굵기 400, 책 CSS 에 font-weight 규칙 없음).
       상속되는 속성이라 html 한 곳이면 본문 전체가 따라온다.
       두께가 도로 필요해지면 이 한 줄만 지우면 된다. */
    -webkit-font-smoothing: antialiased;
  }
  ${FONT_TARGETS} { font-family: "${family}" !important; }
  ${
    // 켰을 때만 규칙을 낸다. 끈 상태에서 400 을 강제하면 책이 지정한 제목·강조의 굵기까지
    // 눌러 버린다 — 끄면 아무것도 주입하지 않는 것이 원래 상태다.
    t.bold ? `${FONT_TARGETS} { font-weight: 700 !important; }` : ""
  }
  p, li, blockquote, dd {
    line-height: ${t.lineHeight};
    letter-spacing: ${t.letterSpacing}em;
    hanging-punctuation: allow-end last;
    widows: 2;
  }
  pre { white-space: pre-wrap !important; }
`;
};

export type Reader = {
  /** lastLocation 에 CFI 를 주면 그 지점에서 시작한다. 없으면 첫 페이지. */
  open(file: Blob, lastLocation?: string | null): Promise<void>;
  goLeft(): void;
  goRight(): void;
  goTo(href: string): Promise<void>;
  toc(): TocItem[];
  /** 다섯 값을 한 번에 적용한다. 주입 CSS + paginator 속성 양쪽을 갱신한다. */
  setTypography(t: Typography): void;
  onRelocate(cb: (loc: Location) => void): void;
  /**
   * 키 핸들러를 등록한다.
   *
   * 본문은 섹션마다 별도 iframe 에 렌더링되므로, 사용자가 본문을 클릭하면 포커스가
   * 그 iframe 안으로 들어간다. 그때부터 키 이벤트는 최상위 window 에 도달하지 않는다.
   * 그래서 최상위 document 와 **로드되는 모든 섹션 문서**에 같은 핸들러를 붙인다.
   * (upstream reader.js 도 동일한 방식이다.)
   */
  onKeydown(handler: (e: KeyboardEvent) => void): void;
};

export function createReader(container: HTMLElement): Reader {
  const view = document.createElement("foliate-view") as any;
  container.append(view);

  let typo: Typography = { ...DEFAULT_TYPOGRAPHY };

  /**
   * 여백은 CSS 주입이 아니라 paginator 속성으로 제어한다 — foliate 가
   * `observedAttributes` 로 이미 지원하며, 값은 CSS 커스텀 프로퍼티로 그대로 들어간다.
   *
   * **`margin` 속성만으로는 여백이 조절되지 않는다 (실측 확인).** paginator 의 그리드는
   * `minmax(margin,1fr) │ min(100%, max-width) │ minmax(margin,1fr)` 이라, 폭 상한을
   * 크게 두면 본문 트랙이 컨테이너 100% 를 요구해 좌우 트랙이 0 으로 붕괴한다.
   * 측정: margin 48→160 은 column-width 1100 불변, max-inline-size 100000→400 은 1100→369.
   *
   * 그래서 **폭 상한을 컨테이너 폭에서 역산**한다: `상한 = 폭 − 2×여백`.
   * 남는 공간이 정확히 좌우 여백이 되어 여백 슬라이더가 어떤 창 크기에서도 실효 제어가 된다.
   * `max-column-count: 1` 로 1단을 고정한다 — 2단을 쓰려면 상한이 폭의 절반이어야 해서
   * 여백 제어와 양립하지 않는다(기본 800px 창에서는 이미 1단이라 체감 변화 없음).
   *
   * 루프는 생기지 않는다: 상한 변경은 `render()` 를 부르지만 컨테이너 크기를 바꾸지
   * 않으므로 아래 ResizeObserver 를 다시 깨우지 않는다. 같은 값 재설정도 막아 둔다.
   */
  const applyLayout = () => {
    const r = view.renderer;
    if (!r) return;
    r.setAttribute("max-column-count", "1");
    // 여백의 최소값으로도 함께 넣어 둔다(폭이 아래 하한에 걸릴 때를 위해).
    r.setAttribute("margin", `${typo.margin}px`);

    const width = container.clientWidth;
    if (width <= 0) return; // 아직 레이아웃 전
    const inline = Math.max(120, width - typo.margin * 2);
    const next = `${Math.round(inline)}px`;
    if (r.getAttribute("max-inline-size") !== next) {
      r.setAttribute("max-inline-size", next);
    }
  };

  /**
   * 이미지를 **현재 페이지(컬럼) 폭**으로 제한한다.
   *
   * foliate 의 `setImageSize()` 는 "이미 max-width 가 설정돼 있으면 보존"한다.
   * 그래서 책이 `<img style="max-width:1218px">` 처럼 직접 지정하면 컬럼(743px)을
   * 넘어 잘린다 — 실측으로 확인한 회귀다.
   *
   * `max-width: 100%` 로 덮는 것으로는 부족하다: 여러 페이지짜리 섹션에서는
   * body 가 컬럼 스트립 전체로 늘어나(측정값 3156·7176px) 100% 가 컬럼 폭이 아니게 된다.
   * 그래서 그 문서의 `column-width` 를 읽어 **px 로** 박는다.
   *
   * foliate 는 인라인 !important 로 쓰므로 우리도 인라인 !important 로 쓴다. 이후 렌더에서
   * foliate 가 다시 읽을 때는 우리 값이 "이미 설정된 max-width" 가 되어 그대로 보존된다.
   */
  const clampImages = () => {
    const contents = view.renderer?.getContents?.() ?? [];
    for (const { doc } of contents) {
      if (!doc?.documentElement || !doc.body) continue;
      const colWidth = parseFloat(
        getComputedStyle(doc.documentElement).columnWidth,
      );
      if (!Number.isFinite(colWidth) || colWidth <= 0) continue;
      const cap = `${Math.floor(colWidth)}px`;
      for (const el of doc.body.querySelectorAll("img, svg, video")) {
        (el as HTMLElement).style.setProperty("max-width", cap, "important");
      }
    }
  };

  // foliate 의 setImageSize 는 render 시점에 돌므로 그 뒤에 덮어써야 한다.
  const clampImagesSoon = () => requestAnimationFrame(() => clampImages());

  // 창 크기가 바뀌면 역산 값도 다시 맞춰야 한다.
  new ResizeObserver(() => {
    applyLayout();
    clampImagesSoon();
  }).observe(container);

  // 섹션이 새로 로드될 때마다 (그리고 페이지 이동으로 재렌더될 때마다) 다시 제한한다.
  view.addEventListener("load", clampImagesSoon);
  view.addEventListener("relocate", clampImagesSoon);

  const keyHandlers: ((e: KeyboardEvent) => void)[] = [];
  const dispatchKey = (e: Event) => {
    for (const h of keyHandlers) h(e as KeyboardEvent);
  };

  // 휠 한 번(마우스 노치) 또는 한 제스처(트랙패드 스와이프)에 한 페이지.
  //
  // **누적 임계값을 두지 않는다.** 예전에는 누적 |deltaY| 가 60 이 되어야 넘겼는데,
  // 노치당 deltaY 는 장치마다 크게 달라서 작은 값을 주는 마우스에서는 십여 번을 굴려야
  // 한 장이 넘어갔다(사람 UAT 에서 "많이 굴려야 넘어간다"로 보고됨). 연속 스크롤의 상한은
  // 아래 쿨다운이 이미 잡으므로 누적은 감도만 깎고 있었다 — 첫 이벤트에서 바로 넘긴다.
  //
  // 느낌이 안 맞으면 쿨다운만 조절하면 된다(늘리면 한 제스처가 넘기는 장수가 줄어든다).
  const WHEEL_DEADZONE = 1; // 가로 스크롤(deltaY≈0)을 페이지 넘김으로 오인하지 않기 위한 하한
  const WHEEL_COOLDOWN_MS = 300; // 넘긴 뒤 이 시간 동안의 델타는 흡수(관성 방지)
  let wheelLockUntil = 0;

  /**
   * @param fromBookContent 섹션 iframe 문서에서 온 이벤트인가.
   *
   * 최상위 문서에는 목차 패널처럼 **자체 스크롤을 가진 앱 크롬**이 함께 산다.
   * 거기서 온 휠까지 가로채면 패널이 스크롤되지 않는다. 그래서 최상위에서 온
   * 이벤트는 **리더 표면 안일 때만** 처리하고, 나머지는 네이티브 스크롤에 넘긴다.
   * (reader.ts 는 `#toc` 같은 앱 크롬을 알지 못한다 — 알 필요도 없다.)
   */
  const makeWheelHandler = (fromBookContent: boolean) => (e: Event) => {
    const ev = e as WheelEvent;

    if (!fromBookContent && !container.contains(ev.target as Node)) return;

    // 페이지네이션 모드는 컨테이너가 overflow:hidden 이라 스크롤할 것이 없다.
    ev.preventDefault();

    const now = performance.now();
    // 트랙패드 관성으로 이어지는 잔여 델타 — 한 제스처가 여러 장을 넘기지 않도록 버린다.
    if (now < wheelLockUntil) return;

    // 가로 스크롤은 페이지 넘김이 아니다 (deltaY 가 0 이면 방향을 정할 수도 없다).
    if (Math.abs(ev.deltaY) < WHEEL_DEADZONE) return;

    wheelLockUntil = now + WHEEL_COOLDOWN_MS;
    // 읽기 순서 기준으로 이동한다. goRight/goLeft 는 공간 기준(RTL 방향 래퍼)이라
    // 아래로 굴렸을 때 RTL 책에서 반대로 간다.
    void (ev.deltaY > 0 ? view.next() : view.prev());
  };

  // 창을 가로 3등분해 좌우 존을 클릭하면 페이지를 넘긴다. 중앙은 무동작(오탐 방지).
  // 손에 안 맞으면 이 값만 고치면 된다 (WHEEL_THRESHOLD 와 같은 방식).
  const ZONE_FRACTION = 1 / 3;

  /**
   * 클릭의 x 를 **창 좌표**로 되돌린다.
   *
   * 섹션 iframe 은 페이지 하나가 아니라 **컬럼 스트립 전체 폭**으로 늘어난 뒤
   * 컨테이너가 가로 스크롤된다(`paginator.js` 의 `#afterRender`). 그래서 iframe 안에서 온
   * `e.clientX` 는 창 좌표가 아니다 — 실측: 2페이지째에서 창 x=128 을 클릭하면
   * `clientX` 가 **1264** 로 들어온다. 그대로 쓰면 좌측 클릭이 우측 존으로 판정된다.
   *
   * iframe 요소의 rect 는 그 스크롤을 반영하므로 `left` 를 더하면 창 좌표가 된다
   * (실측 오차 0.02px). `frameElement` 는 shadow root 가 closed 여도 접근할 수 있다.
   */
  const windowX = (e: MouseEvent, doc: Document): number | null => {
    if (doc === document) return e.clientX;
    const frame = (doc.defaultView as any)?.frameElement as Element | undefined;
    const rect = frame?.getBoundingClientRect();
    return rect ? rect.left + e.clientX : null;
  };

  /**
   * 클릭과 드래그 선택을 **이동 거리**로 가르는 임계값.
   *
   * "선택이 남아 있으면 넘기지 않는다" 로 가르면 안 된다 — 실제 마우스·트랙패드는 클릭
   * 순간에도 흔들려서 **5px 만 어긋나도 한 글자가 선택된다**(Chromium 실측). 그러면 페이지는
   * 넘어가지 않고 글자만 하이라이트된 채 남는다 — 사람 UAT 에서 실제로 보고된 증상이다.
   *
   * 기본 크기 한글 한 글자 폭(~19px)보다 작게 잡아 의도적인 선택과 겹치지 않게 한다.
   * 손맛이 안 맞으면 이 값만 고치면 된다.
   */
  const DRAG_TOLERANCE = 10; // px

  let downX = 0;
  let downY = 0;

  const onMouseDown = (ev: Event) => {
    downX = (ev as MouseEvent).clientX;
    downY = (ev as MouseEvent).clientY;
  };

  /**
   * 좌우 존 위에서 보여 줄 방향 화살표 커서.
   *
   * **커서 이미지는 PNG 여야 한다 — WebKit 은 SVG 를 커서로 렌더하지 않는다.** 처음엔
   * SVG data URI 로 넣었는데, 실앱에서 이미지가 실패해 폴백 키워드로 떨어지고 macOS 가 그것을
   * **좌우 양방향 화살표(↔)** 로 그려서 방향 정보가 사라졌다(사람 UAT 에서 "클릭하다 보면
   * `<>` 가 나온다"로 보고됨). 그래서 canvas 로 같은 모양을 그려 PNG 로 굽는다.
   *
   * `w-resize`/`e-resize` 키워드를 폴백으로 남기지만, 그건 방향이 드러나지 않는 마지막 수단이다.
   * 흰 테두리를 겹쳐 흰 본문 위에서도 보이게 한다.
   */
  const arrowPng = (points: string, size: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.scale(size / 26, size / 26); // 좌표는 26px 기준으로 쓴다
    g.lineCap = "round";
    g.lineJoin = "round";
    const path = new Path2D(points);
    g.strokeStyle = "#fff";
    g.lineWidth = 6;
    g.stroke(path);
    g.strokeStyle = "#222";
    g.lineWidth = 2.5;
    g.stroke(path);
    return canvas.toDataURL("image/png");
  };

  /**
   * 두 형태를 돌려준다. `sharp`(image-set, 레티나 2x 포함)를 먼저 시도하고 파서가 거부하면
   * `plain` 이 남는다 — 인라인 스타일에 순서대로 두 번 대입하는 방식으로 점진 적용한다.
   */
  const arrowCursor = (points: string, fallback: string) => {
    const one = arrowPng(points, 26);
    const two = arrowPng(points, 52);
    if (!one) return { plain: fallback, sharp: "" };
    return {
      plain: `url("${one}") 13 13, ${fallback}`,
      sharp: two
        ? `image-set(url("${one}") 1x, url("${two}") 2x) 13 13, ${fallback}`
        : "",
    };
  };

  const ZONE_CURSOR = {
    left: arrowCursor("M17 5 L8 13 L17 21", "w-resize"),
    right: arrowCursor("M9 5 L18 13 L9 21", "e-resize"),
    none: { plain: "", sharp: "" },
  };

  /** 두 번 대입한다 — `image-set` 이 지원되지 않으면 두 번째 대입이 무시되고 첫 값이 남는다. */
  const setCursor = (el: HTMLElement, zone: keyof typeof ZONE_CURSOR) => {
    el.style.cursor = ZONE_CURSOR[zone].plain;
    if (ZONE_CURSOR[zone].sharp) el.style.cursor = ZONE_CURSOR[zone].sharp;
  };

  type Zone = keyof typeof ZONE_CURSOR;
  let shownZone: Zone | null = null;

  /**
   * 커서는 **본문 문서와 최상위 컨테이너 양쪽**에 걸어야 한다 — 본문이 iframe 이라
   * 최상위에만 걸면 본문 위에서 바뀌지 않고, 본문에만 걸면 좌우 여백에서 바뀌지 않는다.
   * `cursor` 는 상속되므로 `documentElement` 하나로 본문 전체가 따라온다(링크는 UA 스타일의
   * `pointer` 가 그대로 이긴다 — 별도 처리가 필요 없다).
   *
   * **존이 바뀔 때만 세팅하면 안 된다.** foliate 의 `CursorAutohider` 가
   * (`view.js` 의 `show()`) **mousemove 마다** `documentElement.style.removeProperty('cursor')`
   * 를 호출한다 — `autohide-cursor` 속성을 쓰지 않아도 그 줄은 항상 돈다. 그래서 같은 존
   * 안에서 마우스를 움직이는 동안 커서가 지워졌다(사람 UAT 에서 "텍스트 위에서는 커서가
   * 안 나온다"로 보고됨). 우리 리스너는 `document` 에 있어 `documentElement` 보다 **나중에**
   * 버블링을 받으므로, 매번 다시 쓰면 항상 우리 값이 남는다.
   */
  const showZoneCursor = (doc: Document, zone: Zone) => {
    const zoneChanged = zone !== shownZone;
    if (zoneChanged) {
      shownZone = zone;
      setCursor(container, zone);
    }
    if (doc === document) return;
    // 존이 그대로여도 **비어 있으면 다시 쓴다** — autohider 가 지웠다는 뜻이다.
    // 중앙(none)의 정상 상태는 비어 있는 것이라 다시 쓸 것이 없다.
    if (zoneChanged || !doc.documentElement.style.cursor) {
      setCursor(doc.documentElement, zone);
    }
  };

  /** 창 좌표 x 가 어느 존인가. 클릭과 커서가 같은 판정을 쓴다. */
  const zoneAt = (x: number): Zone => {
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return "none";
    const offset = x - rect.left;
    if (offset < rect.width * ZONE_FRACTION) return "left";
    if (offset > rect.width * (1 - ZONE_FRACTION)) return "right";
    return "none";
  };

  const makeMoveHandler =
    (doc: Document, fromBookContent: boolean) => (ev: Event) => {
      const e = ev as MouseEvent;
      // 앱 크롬(목차 패널·햄버거) 위에서는 존 커서를 걷는다 — 클릭과 같은 가드.
      if (!fromBookContent && !container.contains(e.target as Node)) {
        showZoneCursor(doc, "none");
        return;
      }
      const x = windowX(e, doc);
      showZoneCursor(doc, x === null ? "none" : zoneAt(x));
    };

  /** @param fromBookContent 섹션 iframe 문서에서 온 이벤트인가 (휠과 같은 구분). */
  const makeClickHandler =
    (doc: Document, fromBookContent: boolean) => (ev: Event) => {
      const e = ev as MouseEvent;

      // **`e.detail > 1` 을 걸러내면 안 된다.** 빠르게 연속 클릭하면 두 번째 이후가 detail
      // 2·3 으로 들어오므로, 걸러내면 연속 넘김이 죽는다(사람 UAT 에서 보고됨). 대가로 좌우
      // 존에서는 더블클릭 단어 선택이 안 된다(두 클릭이 두 장을 넘기고 선택은 지워진다) —
      // 중앙 1/3 에서는 그대로 되고, 드래그 선택은 어디서나 된다.

      // 최상위 문서에는 목차 패널·햄버거 같은 앱 크롬이 함께 산다 (휠과 같은 가드).
      if (!fromBookContent && !container.contains(e.target as Node)) return;

      // 본문 링크는 view.js 가 이미 처리한다 — 이동한 뒤 페이지까지 넘어가면 안 된다.
      if ((e.target as HTMLElement)?.closest?.("a[href]")) return;

      // 눌렀다 뗀 거리가 임계값을 넘으면 **드래그 선택**이다 — 넘기지 않고 선택을 남긴다.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_TOLERANCE) {
        return;
      }

      const x = windowX(e, doc);
      if (x === null) return;

      const zone = zoneAt(x);
      if (zone === "none") return; // 중앙 1/3 — 무동작

      // 임계값 안의 흔들림이 만든 선택은 지운다 — 안 지우면 넘어간 뒤에도 글자가
      // 하이라이트된 채 남는다(보고된 증상).
      //
      // Chromium 에서는 페이지 넘김 자체가 선택을 지우므로 이 줄은 중복이다(실측: 지워도
      // C3 가 통과한다). **실앱 엔진인 WebKit 은 관측할 수 없어서**(C8 은 closed shadow
      // root 때문에 본문 iframe 에 닿지 못한다) 그쪽에서도 같다고 볼 근거가 없어 남긴다.
      doc.getSelection?.()?.removeAllRanges();

      // 좌/우는 **공간** 기준이다 (←/→ 와 동일 — RTL 책에서는 읽기 순서와 반대가 된다).
      if (zone === "left") view.goLeft();
      else view.goRight();
    };

  // 본문은 섹션마다 별도 iframe 이므로, 최상위 문서에만 붙이면 사용자가 본문에
  // 커서를 올리거나 클릭한 뒤로는 이벤트가 도달하지 않는다.
  // (키보드에서 이미 겪은 회귀 — 같은 경로로 휠·클릭도 함께 붙인다.)
  const bindInput = (doc: Document, fromBookContent: boolean) => {
    doc.addEventListener("keydown", dispatchKey);
    // wheel 은 기본이 passive 라 preventDefault 가 무시된다 — 명시적으로 끈다.
    doc.addEventListener("wheel", makeWheelHandler(fromBookContent), {
      passive: false,
    });
    // click 은 down/up 의 이동 거리로 드래그와 구분하므로 mousedown 도 함께 필요하다.
    doc.addEventListener("mousedown", onMouseDown);
    doc.addEventListener("click", makeClickHandler(doc, fromBookContent));
    doc.addEventListener("mousemove", makeMoveHandler(doc, fromBookContent));
  };

  bindInput(document, false);
  view.addEventListener("load", (e: Event) => {
    const doc = (e as CustomEvent).detail?.doc as Document | undefined;
    if (!doc) return;
    bindInput(doc, true);
    // 새로 로드된 섹션에도 지금 보이고 있는 존 커서를 그대로 입힌다 — 마우스를 움직이지
    // 않고 페이지만 넘긴 경우에도 커서가 유지되어야 한다.
    if (shownZone) setCursor(doc.documentElement, shownZone);
  });

  /**
   * 슬라이더·셀렉트에 포커스가 있을 때는 페이지 넘김 키를 가로채지 않는다.
   * ←/→/↑/↓/스페이스는 모두 폼 컨트롤의 조작 키이기도 해서, 가드가 없으면
   * 설정 패널의 슬라이더를 키보드로 조절할 수 없게 된다.
   */
  const isFormControl = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el || typeof el.tagName !== "string") return false;
    return (
      /^(INPUT|SELECT|TEXTAREA|BUTTON|OPTION)$/.test(el.tagName) ||
      el.isContentEditable === true
    );
  };

  /**
   * 책의 처음(0)/끝(1)으로 이동한다. 진행률 기준이라 섹션 경계와 무관하다 —
   * foliate 의 `getSection()` 은 `≤0` 을 [첫 섹션, 0], `≥1` 을 [마지막 섹션, 1] 로 준다.
   *
   * `goToFraction` 은 내부 `#sectionProgress` 에 null 가드가 없어서, 그게 없는 책
   * (EPUB 이 아닌 포맷 등)에서는 던진다. 그때는 섹션 인덱스로 대체한다.
   */
  const goToBookEdge = async (fraction: 0 | 1) => {
    try {
      await view.goToFraction(fraction);
    } catch {
      const last = (view.book?.sections?.length ?? 1) - 1;
      await view.goTo(fraction === 0 ? 0 : Math.max(0, last));
    }
  };

  // 페이지 넘김은 리더 자신의 키 동작이다.
  keyHandlers.push((e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isFormControl(e.target)) return;

    switch (e.key) {
      // ←/→ 는 **공간** 기준이다 (goLeft/goRight 가 RTL 방향 래퍼).
      case "ArrowLeft":
        e.preventDefault();
        view.goLeft();
        break;
      case "ArrowRight":
        e.preventDefault();
        view.goRight();
        break;
      // ↑/↓/스페이스는 **읽기 순서** 기준이다 — 아래로 가면 RTL 책에서도 다음 내용.
      // 휠과 같은 원칙(next/prev).
      case "ArrowDown":
      case " ":
      case "PageDown":
        e.preventDefault();
        void view.next();
        break;
      case "ArrowUp":
      case "PageUp":
        e.preventDefault();
        void view.prev();
        break;
      // 책 전체의 처음/끝. 섹션 처음/끝이 아니다.
      // 책 전체의 처음/끝. 섹션 처음/끝이 아니다.
      case "Home":
        e.preventDefault();
        void goToBookEdge(0);
        break;
      case "End":
        e.preventDefault();
        void goToBookEdge(1);
        break;

    }
  });

  return {
    async open(file: Blob, lastLocation?: string | null) {
      // view.open() 은 기존 renderer 를 정리하지 않고 새로 만들어 append 만 한다.
      // close() 없이 두 번 열면 옛 renderer 가 DOM 에 남아 옛 책을 계속 보여준다.
      // (close() 는 renderer?.destroy() 라 아무것도 안 열린 상태에서도 안전하다.)
      view.close();
      await view.open(file);
      view.renderer.setStyles?.(bookCss(typo));
      applyLayout();
      // init() 은 lastLocation 이 있으면 그 지점으로, 없으면 첫 페이지로 이동하며
      // 렌더가 끝난 뒤 resolve 한다. 예전의 renderer.next() 를 대체한다.
      await view.init({ lastLocation: lastLocation ?? undefined });
    },
    goLeft: () => view.goLeft(),
    goRight: () => view.goRight(),
    goTo: (href: string) => view.goTo(href),
    toc: () => view.book?.toc ?? [],
    setTypography(next: Typography) {
      typo = next;
      view.renderer?.setStyles?.(bookCss(typo));
      applyLayout();
      clampImagesSoon(); // 여백이 바뀌면 컬럼 폭도 바뀐다
    },
    onRelocate(cb) {
      view.addEventListener("relocate", (e: CustomEvent) =>
        cb(e.detail as Location),
      );
    },
    onKeydown(handler) {
      keyHandlers.push(handler);
    },
  };
}

/** 중첩된 목차를 평탄화한다. 패널 렌더링과 검증 양쪽에서 쓴다. */
export function flattenToc(items: TocItem[]): TocItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.subitems ? flattenToc(item.subitems) : []),
  ]);
}
