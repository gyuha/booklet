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
  const dispatch = (e: Event) => {
    for (const h of keyHandlers) h(e as KeyboardEvent);
  };

  // 최상위 문서 + 섹션 iframe 문서 양쪽에 붙인다.
  document.addEventListener("keydown", dispatch);
  view.addEventListener("load", (e: Event) => {
    (e as CustomEvent).detail?.doc?.addEventListener("keydown", dispatch);
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
