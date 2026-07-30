// Tauri 배선. 책을 여는 경로는 세 가지 — ⌘O 대화상자 / 드래그앤드롭 / macOS "다음으로 열기".
// 세 경로 모두 최종적으로 "파일 경로"를 만들어 openPath()로 흘려보낸다.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { createReader, flattenToc, type Typography } from "./reader";
import { availableFonts } from "./fonts";
import { renderProgress } from "./progress";

/** state.json 과 1:1. 타이포그래피는 전역이라 positions 처럼 책별로 갖지 않는다. */
type AppState = {
  lastBook: string | null;
  positions: Record<string, string>;
  fontScale: number;
  fontFamily: string | null;
  lineHeight: number;
  letterSpacing: number;
  margin: number;
};

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;

const emptyEl = document.querySelector<HTMLElement>("#empty")!;
const readerEl = document.querySelector<HTMLElement>("#reader")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const openButton = document.querySelector<HTMLButtonElement>("#open-button")!;
const panelToggle = document.querySelector<HTMLButtonElement>("#panel-toggle")!;
const panelEl = document.querySelector<HTMLElement>("#panel")!;
const tocBody = document.querySelector<HTMLElement>("#toc")!;
const settingsBody = document.querySelector<HTMLElement>("#settings")!;
const progressEl = document.querySelector<HTMLElement>("#progress")!;
const progressFill = document.querySelector<HTMLElement>("#progress-fill")!;
const progressPct = document.querySelector<HTMLElement>("#progress-pct")!;
const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".panel-tab"),
);

// 리더를 처음부터 만들어 둔다. 그래야 키 핸들러 등록 경로가 하나로 유지된다 —
// reader 가 document 와 모든 섹션 iframe 에 핸들러를 붙이므로, main 은 window 에
// 따로 붙이지 않는다. 따로 붙이면 최상위 포커스에서 ⌘O 가 두 번 발동한다.
const reader = createReader(readerEl);

let state: AppState = {
  lastBook: null,
  positions: {},
  fontScale: 1,
  fontFamily: null,
  lineHeight: 1.7,
  letterSpacing: 0,
  margin: 48,
};
let currentPath: string | null = null;
let bookLoaded = false;

// relocate 는 페이지를 넘길 때마다, 슬라이더는 끌 때마다 발생하므로 저장을 모은다.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void invoke("save_state", { next: state }).catch((e) =>
      console.error("상태 저장 실패", e),
    );
  }, 500);
}

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

// ─────────────────────────── 타이포그래피 ───────────────────────────

const typography = (): Typography => ({
  fontFamily: state.fontFamily,
  fontScale: state.fontScale,
  lineHeight: state.lineHeight,
  letterSpacing: state.letterSpacing,
  margin: state.margin,
});

function applyTypography() {
  reader.setTypography(typography());
}

// ─────────────────────────── 패널 (목차 / 설정) ───────────────────────────

type Tab = "toc" | "settings";
let activeTab: Tab = "toc";

/**
 * 패널 표시를 한 곳에서만 바꾼다. 햄버거 버튼은 기본적으로 hover 에서만 보이는데,
 * **패널이 열려 있는 동안에는 계속 보여야** 한다(닫을 방법이 눈에 있어야 하므로).
 * 그 상태를 CSS 로 알려면 클래스가 필요하다 — 버튼이 DOM 에서 패널보다 앞에 있어
 * 형제 선택자로는 잡을 수 없고, :has() 는 엔진 지원에 의존하게 된다.
 */
function setPanelVisible(visible: boolean) {
  panelEl.hidden = !visible;
  panelToggle.classList.toggle("pinned", visible);
}

function activateTab(tab: Tab) {
  activeTab = tab;
  tocBody.hidden = tab !== "toc";
  settingsBody.hidden = tab !== "settings";
  for (const b of tabButtons) {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  }
}

/** 같은 탭을 다시 부르면 닫고, 다른 탭이면 그 탭으로 전환한다. */
function togglePanel(tab: Tab) {
  if (!bookLoaded) return;
  if (panelEl.hidden) {
    activateTab(tab);
    setPanelVisible(true);
  } else if (activeTab === tab) {
    setPanelVisible(false);
  } else {
    activateTab(tab);
  }
}

function renderToc() {
  tocBody.replaceChildren();
  const items = flattenToc(reader.toc()).filter((i) => i.href);
  for (const item of items) {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "toc-item";
    entry.textContent = item.label?.trim() || "(제목 없음)";
    entry.addEventListener("click", () => {
      void reader.goTo(item.href as string);
      setPanelVisible(false);
    });
    tocBody.append(entry);
  }
}

// ─────────────────────────── 설정 컨트롤 ───────────────────────────

const fontSelect = document.querySelector<HTMLSelectElement>("#set-font")!;

type Slider = {
  input: HTMLInputElement;
  output: HTMLOutputElement;
  format: (v: number) => string;
  read: () => number;
  write: (v: number) => void;
};

const sliders: Slider[] = [
  {
    input: document.querySelector<HTMLInputElement>("#set-scale")!,
    output: document.querySelector<HTMLOutputElement>("#out-scale")!,
    format: (v) => `${Math.round(v * 100)}%`,
    read: () => state.fontScale,
    write: (v) => (state.fontScale = v),
  },
  {
    input: document.querySelector<HTMLInputElement>("#set-line")!,
    output: document.querySelector<HTMLOutputElement>("#out-line")!,
    format: (v) => v.toFixed(2),
    read: () => state.lineHeight,
    write: (v) => (state.lineHeight = v),
  },
  {
    input: document.querySelector<HTMLInputElement>("#set-letter")!,
    output: document.querySelector<HTMLOutputElement>("#out-letter")!,
    format: (v) => `${v.toFixed(2)}em`,
    read: () => state.letterSpacing,
    write: (v) => (state.letterSpacing = v),
  },
  {
    input: document.querySelector<HTMLInputElement>("#set-margin")!,
    output: document.querySelector<HTMLOutputElement>("#out-margin")!,
    format: (v) => `${Math.round(v)}px`,
    read: () => state.margin,
    write: (v) => (state.margin = v),
  },
];

/** 상태 → UI. ⌘+/⌘- 로 값이 바뀔 때도 불러 슬라이더를 맞춘다. */
function syncControls() {
  for (const s of sliders) {
    const v = s.read();
    s.input.value = String(v);
    s.output.textContent = s.format(v);
  }
  fontSelect.value = state.fontFamily ?? "";
}

function buildFontSelect() {
  const options = availableFonts();
  fontSelect.replaceChildren();
  for (const o of options) {
    const el = document.createElement("option");
    el.value = o.family ?? "";
    el.textContent = o.label;
    fontSelect.append(el);
  }

  // 다른 머신에서 저장된 글꼴이 여기 없을 수 있다. 그대로 두면 CSS 가 폴백되어
  // "설정했는데 아무 일도 안 일어난다"로 보이므로 기본값으로 되돌린다.
  if (state.fontFamily && !options.some((o) => o.family === state.fontFamily)) {
    state.fontFamily = null;
    scheduleSave();
  }
}

for (const s of sliders) {
  s.input.addEventListener("input", () => {
    s.write(parseFloat(s.input.value));
    s.output.textContent = s.format(s.read());
    applyTypography();
    scheduleSave();
  });
}

fontSelect.addEventListener("change", () => {
  state.fontFamily = fontSelect.value || null;
  applyTypography();
  scheduleSave();
});

// ─────────────────────────── 책 열기 ───────────────────────────

/** 성공하면 true. 실패해도 예외를 던지지 않는다 (호출부가 분기해야 하므로). */
async function openPath(rawPath: string): Promise<boolean> {
  // macOS 는 경로를 **NFD**(자모 분해)로 넘겨준다. "다음으로 열기" 와 파일 대화상자가
  // 서로 다른 정규화로 같은 파일을 가리키면 positions 에 두 항목이 생겨
  // 위치 복원이 조용히 실패한다 (한국어 파일명에서 항상 발생).
  // APFS 조회는 정규화 비민감하므로 NFC 로 통일해도 파일은 그대로 읽힌다.
  const path = rawPath.normalize("NFC");

  errorEl.hidden = true;
  const wasLoaded = bookLoaded;
  const previousPath = currentPath;

  // open() 전에 보이게 해야 한다. display:none 상태에서는 크기가 0이라
  // paginator 가 페이지 나눔을 계산하지 못한다.
  readerEl.hidden = false;
  emptyEl.hidden = true;

  // **open() 보다 먼저** 바꿔야 한다. 렌더링 중 발생하는 relocate 가 아직
  // 이전 책 경로로 귀속되면, 새 책의 위치가 옛 책에 덮여 쓰인다.
  currentPath = path;

  try {
    const bytes = await invoke<ArrayBuffer>("read_book", { path });
    const name = path.split("/").pop() ?? "book.epub";
    const file = new File([bytes], name, { type: "application/epub+zip" });

    await reader.open(file, state.positions[path] ?? null);

    bookLoaded = true;
    state.lastBook = path;
    scheduleSave();

    document.title = name.replace(/\.epub$/i, "");
    renderToc();
    panelToggle.hidden = false;
    progressEl.hidden = false;
    setPanelVisible(false);
    return true;
  } catch (e) {
    currentPath = wasLoaded ? previousPath : null;
    setPanelVisible(false);
    if (!wasLoaded) {
      readerEl.hidden = true;
      emptyEl.hidden = false;
      panelToggle.hidden = true;
      progressEl.hidden = true;
    }
    showError(`열지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

async function pickAndOpen() {
  const path = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "EPUB", extensions: ["epub"] }],
  });
  if (typeof path === "string") await openPath(path);
}

// ─────────────────────────── 입력 배선 ───────────────────────────

function setScale(next: number) {
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  state.fontScale = Math.round(clamped * 100) / 100;
  applyTypography();
  syncControls();
  scheduleSave();
}

openButton.addEventListener("click", () => void pickAndOpen());
panelToggle.addEventListener("click", () => togglePanel(activeTab));
for (const b of tabButtons) {
  b.addEventListener("click", () => activateTab(b.dataset.tab as Tab));
}

reader.onKeydown((e) => {
  if (e.key === "Escape" && !panelEl.hidden) {
    setPanelVisible(false);
    return;
  }
  if (!e.metaKey) return;
  switch (e.key) {
    case "o":
      e.preventDefault();
      void pickAndOpen();
      break;
    case "t":
      e.preventDefault();
      togglePanel("toc");
      break;
    case ",":
      e.preventDefault();
      togglePanel("settings");
      break;
    // ⌘+ 는 레이아웃에 따라 "+" 또는 "=" 로 들어온다.
    case "+":
    case "=":
      e.preventDefault();
      setScale(state.fontScale + 0.1);
      break;
    case "-":
      e.preventDefault();
      setScale(state.fontScale - 0.1);
      break;
    case "0":
      e.preventDefault();
      setScale(1);
      break;
  }
});

reader.onRelocate((loc) => {
  // **아래 조기 반환보다 먼저** 갱신한다. 뒤에 두면 currentPath 나 cfi 가 없는
  // relocate 에서 진행률이 조용히 멈춘다.
  renderProgress(progressFill, progressPct, loc.fraction);

  if (!currentPath || !loc.cfi) return;
  state.positions[currentPath] = loc.cfi;
  scheduleSave();
});

void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type !== "drop") return;
  const path = event.payload.paths.find((p) =>
    p.toLowerCase().endsWith(".epub"),
  );
  if (path) void openPath(path);
});

// macOS "다음으로 열기" — 창이 뜨기 전에 도착한 건 Rust가 버퍼링해 두고,
// 그 뒤에 오는 건 이벤트로 받는다.
void listen<string>("book-opened", (event) => void openPath(event.payload));

// ─────────────────────────── 시작 ───────────────────────────

async function boot() {
  state = await invoke<AppState>("load_state").catch((e) => {
    console.error("상태 로드 실패", e);
    return state;
  });

  buildFontSelect();
  syncControls();
  activateTab("toc");
  applyTypography();

  const pending = await invoke<string | null>("take_pending_book");
  if (pending) {
    await openPath(pending);
    return;
  }

  // 파일 인자 없이 실행 → 마지막으로 읽던 책을 그 지점에서 이어본다.
  if (state.lastBook) {
    const ok = await openPath(state.lastBook);
    if (!ok) {
      // 삭제·이동된 책을 계속 붙들고 있으면 매번 실패한다.
      state.lastBook = null;
      scheduleSave();
    }
  }
}

void boot();
