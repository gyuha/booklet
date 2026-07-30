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
};

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: null,
  fontScale: 1,
  lineHeight: 1.7,
  letterSpacing: 0,
  margin: 48,
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
  html { font-size: ${Math.round(t.fontScale * 100)}%; }
  ${FONT_TARGETS} { font-family: "${family}" !important; }
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
  // 느낌이 안 맞으면 이 두 값만 조절하면 된다.
  const WHEEL_THRESHOLD = 60; // 누적 |deltaY| 가 이만큼이면 한 페이지
  const WHEEL_COOLDOWN_MS = 300; // 넘긴 뒤 이 시간 동안의 델타는 흡수(관성 방지)
  let wheelAccum = 0;
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
    if (now < wheelLockUntil) {
      // 트랙패드 관성으로 이어지는 잔여 델타 — 한 제스처가 여러 장을 넘기지 않도록 버린다.
      wheelAccum = 0;
      return;
    }

    wheelAccum += ev.deltaY;
    if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) return;

    const forward = wheelAccum > 0;
    wheelAccum = 0;
    wheelLockUntil = now + WHEEL_COOLDOWN_MS;
    // 읽기 순서 기준으로 이동한다. goRight/goLeft 는 공간 기준(RTL 방향 래퍼)이라
    // 아래로 굴렸을 때 RTL 책에서 반대로 간다.
    void (forward ? view.next() : view.prev());
  };

  // 본문은 섹션마다 별도 iframe 이므로, 최상위 문서에만 붙이면 사용자가 본문에
  // 커서를 올리거나 클릭한 뒤로는 이벤트가 도달하지 않는다.
  // (키보드에서 이미 겪은 회귀 — 같은 경로로 휠도 함께 붙인다.)
  const bindInput = (doc: Document, fromBookContent: boolean) => {
    doc.addEventListener("keydown", dispatchKey);
    // wheel 은 기본이 passive 라 preventDefault 가 무시된다 — 명시적으로 끈다.
    doc.addEventListener("wheel", makeWheelHandler(fromBookContent), {
      passive: false,
    });
  };

  bindInput(document, false);
  view.addEventListener("load", (e: Event) => {
    const doc = (e as CustomEvent).detail?.doc as Document | undefined;
    if (doc) bindInput(doc, true);
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
