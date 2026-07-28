# 검증 체크 세트 (C1–C9)

`task check` 가 전부 실행한다. 하나가 실패해도 나머지를 계속 돌리고 마지막에 실패
목록을 낸다(fail-fast 가 아니다 — 매 라운드 모든 체크의 상태를 알아야 하므로).
개별 실행은 `task check:c3` 형태. `pnpm check` 는 `task check` 의 별칭이다.

| | 무엇을 보는가 | 어디에 있는가 |
|---|---|---|
| **C1** | 릴리스 빌드가 되고 `.app` 이 생성되는가 | Taskfile |
| **C2** | `tsc --noEmit` + `clippy -D warnings` | Taskfile |
| **C3** | Chromium(Playwright)에서 렌더링·페이지넘김·클릭후키·**마우스휠**·두번째책·위치복원·글꼴배율 | `render.spec.ts` |
| **C4** | 상태 영속성 단위 테스트 3개 (왕복 / 손상 JSON / 없는 파일) | `state-tests.sh` |
| **C5** | epub 핸들러 등록이 무해한가 (role=Viewer, 기본 앱 자리 불변) | `macos-registration.sh` |
| **C6** | foliate-js 가 upstream 커밋 고정 벤더링인가, npm 재배포판에 의존하지 않는가 | `vendor-integrity.sh` |
| **C7** | `.app` 이 뜨고 5초를 버티는가 (크래시 감지) | `launch-survives.sh` |
| **C8** | **실앱과 같은 엔진(WKWebView)** 에서 렌더링이 동작하는가 | `wkwebview-render.sh` |
| **C9** | **실제 앱** 종단 — 이어보기·위치복원·두번째책 (`state.json` 관측) | `app-state-e2e.sh` |

## 설계 원칙

**"체크가 통과했다"가 "동작한다"를 뜻하지 않는다.** 이 세트는 그걸 두 번 실물로 겪고
자란 결과다. 두 번 모두 체크 전부가 통과하는데 사용자 눈에는 버그가 보였다.

1. **정적 스냅샷이 아니라 조작 시퀀스를 검증한다.** "로드 직후 상태"만 보면
   *본문을 클릭한 뒤* 키가 죽는 버그, *책을 열어둔 채* 또 여는 버그를 못 잡는다.
   C3 의 클릭후키·휠·두번째책 케이스와 C9 가 그래서 존재한다.
   입력 이벤트는 특히 **커서가 본문 iframe 위에 있는 상태**를 재현해야 한다 —
   키보드와 휠 모두 최상위 문서에만 붙이면 조용히 죽는다.
2. **새 체크는 일부러 깨뜨려 실패를 확인한 뒤 채택한다.** 통과하는 것만 보면
   공허한 체크(예: 테스트 0개인 `cargo test` 는 exit 0)를 걸러낼 수 없다.
3. **체크를 느슨하게 고쳐 통과시키지 않는다.** 임계값 낮추기·단언 삭제·샘플 교체는
   금지. 체크가 틀렸다고 판단되면 *더 엄격하고 측정 가능하게* 고친다.

## 관측 수단과 그 한계

GUI 관측 수단은 이 머신에서 전부 권한 차단이다 — `screencapture`(화면 기록),
접근성 기반 도구, AppleScript System Events. **그래서 우회 채널을 쓴다.**

- **C8 오프스크린 WKWebView** — `setActivationPolicy(.prohibited)` 로 창 없이 띄우므로
  GUI 권한이 필요 없다. 실앱과 같은 `AppleWebKit` 엔진을 검증한다.
  다만 foliate 의 shadow root 가 `mode:'closed'` 라 페이지 JS 로는 본문 iframe 에
  접근할 수 없다 → **목차·CFI 만 관측**한다.
- **C3 Playwright** — 브라우저 레벨에서 shadow DOM 을 넘어 iframe 에 접근할 수 있어
  **본문 텍스트와 계산된 font-size 를 단언**한다. 대신 엔진이 Chromium 이다.
  → C3 와 C8 은 이 역할을 분담한다. 둘 다 필요하다.
- **C9 `state.json`** — `positions[경로]` 는 paginator 가 `relocate` 를 발생시킨 뒤에만
  기록되므로 **CFI 존재 = 실앱에서 실제로 렌더링됨**의 증거다. 창을 못 보는 상황에서
  "정말 동작하는가" 에 가장 가까운 관측. 사용자 상태 파일은 백업·복원한다.

### 여전히 사람만 확인할 수 있는 것

- Finder 에서 `.epub` 아이콘이 표지로 보이는가 (C5 는 회귀의 *원인 경로*만 차단)
- ⌘O 네이티브 대화상자, 드래그앤드롭 OS 제스처 (이벤트 이후 경로는 C9 가 덮는다)
- 목차 패널 클릭, ⌘+/⌘- 키 바인딩 (데이터·메커니즘은 검증됨)
- 휠의 **체감**(임계값 60 / 쿨다운 300ms) — 동작은 C3 가 검증하지만 손맛은 사람만 안다
- 한국어 본문의 실제 가독성

## 샘플 의존성

C3·C8·C9 는 `~/Downloads` 의 두 epub 을 쓴다. `BOOKLET_SAMPLE_EPUB` /
`BOOKLET_SAMPLE_EPUB2` 로 바꿀 수 있다. 개발 서버가 `/fixtures/{a,b}.epub` 로 서빙한다
(`vite.config.ts` 의 `serveEpubFixtures`, 개발 전용).

**주의**: `app-state-e2e.sh` 의 `SENTINEL` 은 샘플 A 안의 실제 지점을 가리킨다.
샘플을 바꾸면 그 책의 CFI 로 갱신해야 한다. CFI 문자열로 두 책을 구별할 수는 없다 —
책 상대 경로라서 서로 다른 책이 각자 표지에서 열리면 문자열이 같아진다.
