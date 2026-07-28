// Tauri 배선. 책을 여는 경로는 세 가지 — ⌘O 대화상자 / 드래그앤드롭 / macOS "다음으로 열기".
// 세 경로 모두 최종적으로 "파일 경로"를 만들어 openPath()로 흘려보낸다.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { createReader } from "./reader";

const emptyEl = document.querySelector<HTMLElement>("#empty")!;
const readerEl = document.querySelector<HTMLElement>("#reader")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const openButton = document.querySelector<HTMLButtonElement>("#open-button")!;

// 리더를 처음부터 만들어 둔다. 그래야 키 핸들러 등록 경로가 하나로 유지된다 —
// reader 가 document 와 모든 섹션 iframe 에 핸들러를 붙이므로, main 은 window 에
// 따로 붙이지 않는다. 따로 붙이면 최상위 포커스에서 ⌘O 가 두 번 발동한다.
const reader = createReader(readerEl);
let bookLoaded = false;

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

async function openPath(path: string) {
  errorEl.hidden = true;
  const wasLoaded = bookLoaded;

  // open() 전에 보이게 해야 한다. display:none 상태에서는 크기가 0이라
  // paginator 가 페이지 나눔을 계산하지 못한다.
  readerEl.hidden = false;
  emptyEl.hidden = true;

  try {
    const bytes = await invoke<ArrayBuffer>("read_book", { path });
    const name = path.split("/").pop() ?? "book.epub";
    const file = new File([bytes], name, { type: "application/epub+zip" });

    await reader.open(file);
    bookLoaded = true;
    document.title = name.replace(/\.epub$/i, "");
  } catch (e) {
    if (!wasLoaded) {
      readerEl.hidden = true;
      emptyEl.hidden = false;
    }
    showError(`열지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
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

// 1. ⌘O / 버튼
openButton.addEventListener("click", () => void pickAndOpen());
reader.onKeydown((e) => {
  if (e.metaKey && e.key === "o") {
    e.preventDefault();
    void pickAndOpen();
  }
});

// 2. 드래그앤드롭
void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type !== "drop") return;
  const path = event.payload.paths.find((p) =>
    p.toLowerCase().endsWith(".epub"),
  );
  if (path) void openPath(path);
});

// 3. macOS "다음으로 열기" — 창이 뜨기 전에 도착한 건 Rust가 버퍼링해 두고,
//    그 뒤에 오는 건 이벤트로 받는다.
void listen<string>("book-opened", (event) => void openPath(event.payload));
void invoke<string | null>("take_pending_book").then((path) => {
  if (path) void openPath(path);
});
