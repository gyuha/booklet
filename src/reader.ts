// foliate-js 렌더러 래퍼. Tauri API를 일절 쓰지 않는다 —
// 그래야 브라우저(Playwright)와 WKWebView 하네스에서 그대로 검증할 수 있다.
import "../vendor/foliate-js/view.js";

export type TocItem = {
  label: string;
  href: string | null;
  subitems?: TocItem[];
};

export type Location = {
  cfi?: string;
  fraction?: number;
};

// 본문에 주입할 최소 스타일. epub 자체 CSS를 덮어쓰지 않도록 최소한만 건드린다.
// html 의 font-size 를 배율로 잡으면 em/% 기반인 epub 본문이 함께 따라온다.
const bookCss = (scale: number) => `
  html { font-size: ${Math.round(scale * 100)}%; }
  p, li, blockquote, dd {
    line-height: 1.7;
    hanging-punctuation: allow-end last;
    widows: 2;
  }
  pre { white-space: pre-wrap !important; }
`;

export type Reader = {
  /** lastLocation 에 CFI 를 주면 그 지점에서 시작한다. 없으면 첫 페이지. */
  open(file: Blob, lastLocation?: string | null): Promise<void>;
  goLeft(): void;
  goRight(): void;
  goTo(href: string): Promise<void>;
  toc(): TocItem[];
  setFontScale(scale: number): void;
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

  let scale = 1;

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

  // 페이지 넘김은 리더 자신의 키 동작이다.
  keyHandlers.push((e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      view.goLeft();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      view.goRight();
    }
  });

  return {
    async open(file: Blob, lastLocation?: string | null) {
      // view.open() 은 기존 renderer 를 정리하지 않고 새로 만들어 append 만 한다.
      // close() 없이 두 번 열면 옛 renderer 가 DOM 에 남아 옛 책을 계속 보여준다.
      // (close() 는 renderer?.destroy() 라 아무것도 안 열린 상태에서도 안전하다.)
      view.close();
      await view.open(file);
      view.renderer.setStyles?.(bookCss(scale));
      // init() 은 lastLocation 이 있으면 그 지점으로, 없으면 첫 페이지로 이동하며
      // 렌더가 끝난 뒤 resolve 한다. 예전의 renderer.next() 를 대체한다.
      await view.init({ lastLocation: lastLocation ?? undefined });
    },
    goLeft: () => view.goLeft(),
    goRight: () => view.goRight(),
    goTo: (href: string) => view.goTo(href),
    toc: () => view.book?.toc ?? [],
    setFontScale(next: number) {
      scale = next;
      view.renderer?.setStyles?.(bookCss(scale));
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
