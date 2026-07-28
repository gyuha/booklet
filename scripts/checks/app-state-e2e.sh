#!/usr/bin/env bash
# C9 — 실제 앱을 띄워 Tauri 배선 전체를 관통 검증한다 (GUI 권한 불필요).
#
# 관측 채널은 state.json 이다. positions[경로] 는 paginator 가 relocate 를 발생시킨
# 뒤에만 기록되므로, **파일에 CFI 가 있다는 것은 실앱에서 책이 실제로 렌더링됐다는 증거**다.
# 창 내용을 볼 수 없는 상황에서 "정말 동작하는가" 에 가장 가까운 관측이다.
#
# 검증 항목:
#   (a) 위치를 심어 두고 **파일 인자 없이** 실행하면 마지막 책을 자동으로 이어본다 (S5)
#   (b) 그 위치가 실제로 복원된다 — 심어 둔 섹션에서 시작한다 (S4)
#   (c) 실행 중인 앱에 두 번째 책을 주면 교체되고 lastBook 이 갱신된다 (RunEvent::Opened)
#   (d) **두 번째 책의 위치가 첫 책의 위치를 덮지 않는다** (실제로 발생한 회귀)
#
# 주의: (b)(d) 는 샘플 A 안의 실제 지점을 가리키는 SENTINEL 에 의존한다.
#       샘플을 바꾸면 SENTINEL 도 그 책의 CFI 로 갱신해야 한다.
#       CFI 문자열 비교로 두 책을 구별할 수는 없다 — CFI 는 책 상대 경로라
#       서로 다른 책이 각자 표지에서 열리면 문자열이 같아진다. 그래서 위치를 미리 심는다.
set -uo pipefail
cd "$(dirname "$0")/../.."

APP="src-tauri/target/release/bundle/macos/booklet.app"
BIN="booklet.app/Contents/MacOS/booklet"
STATE="$HOME/Library/Application Support/com.gyuha.booklet/state.json"
BACKUP="${TMPDIR:-/tmp}/booklet-state-backup-$$.json"
A="${BOOKLET_SAMPLE_EPUB:-$HOME/Downloads/내면 근력 결국 멘탈 게임이다.epub}"
B="${BOOKLET_SAMPLE_EPUB2:-$HOME/Downloads/신 퇴마록 신세편 1.epub}"

# 샘플 A 의 본문 한가운데. 표지(/6/2)와 확실히 다른 섹션이라야 복원을 판정할 수 있다.
SENTINEL='epubcfi(/6/24!/4/2[bdb-chapter12],/2,/22/1:151)'
SENTINEL_SECTION='epubcfi(/6/24'

export A B SENTINEL SENTINEL_SECTION STATE

cleanup() {
  pkill -f "$BIN" 2>/dev/null
  # 사용자의 실제 상태를 되돌려 놓는다.
  if [ -f "$BACKUP" ]; then
    mv -f "$BACKUP" "$STATE"
  else
    rm -f "$STATE"
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL(C9): $*" >&2
  exit 1
}

[ -d "$APP" ] || fail "빌드 산출물이 없다: $APP"
[ -f "$A" ] || fail "샘플 epub 이 없다: $A"
[ -f "$B" ] || fail "두 번째 샘플 epub 이 없다: $B"

[ -f "$STATE" ] && cp "$STATE" "$BACKUP"

require_running() {
  for _ in $(seq 1 15); do
    pgrep -f "$BIN" >/dev/null && return 0
    sleep 1
  done
  fail "앱이 실행되지 않았다 ($1)"
}

# state.json 이 조건을 만족할 때까지 기다린다 (저장은 500ms 지연 + 렌더 시간).
# 경로는 NFC 로 정규화해 비교한다 — macOS 는 NFD 로 넘기고 앱은 NFC 로 저장한다.
wait_state() {
  local expr="$1" label="$2"
  for _ in $(seq 1 45); do
    if [ -f "$STATE" ] && node -e "
      const s = JSON.parse(require('fs').readFileSync(process.env.STATE, 'utf8'));
      const a = process.env.A.normalize('NFC');
      const b = process.env.B.normalize('NFC');
      process.exit(($expr) ? 0 : 1);
    " 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "  현재 state.json:" >&2
  cat "$STATE" 2>/dev/null >&2 || echo "  (파일 없음)" >&2
  fail "$label"
}

read_state() {
  node -e "
    const s = JSON.parse(require('fs').readFileSync(process.env.STATE, 'utf8'));
    const a = process.env.A.normalize('NFC');
    const b = process.env.B.normalize('NFC');
    console.log($1 ?? '');
  "
}

pkill -f "$BIN" 2>/dev/null
sleep 3 # 종료가 완전히 끝나기를 기다린다 (open -a 경합 방지)

# 위치를 심는다. 이 상태에서 파일 인자 없이 실행하면 이어보기가 발동해야 한다.
mkdir -p "$(dirname "$STATE")"
node -e "
  const fs = require('fs');
  fs.writeFileSync(process.env.STATE, JSON.stringify({
    lastBook: process.env.A.normalize('NFC'),
    positions: { [process.env.A.normalize('NFC')]: process.env.SENTINEL },
    fontScale: 1.0,
  }, null, 2));
" || fail "state.json 을 심지 못했다"

# (a)(b) 파일 인자 없이 실행 → 마지막 책을 심어 둔 위치에서 이어본다
open -a "$PWD/$APP" || fail "open -a 실패 (인자 없음)"
require_running "이어보기"
wait_state "(s.positions[a] || '').startsWith(process.env.SENTINEL_SECTION)" \
  "마지막 책을 심어 둔 섹션에서 이어보지 않았다 (이어보기 또는 위치 복원 실패)"

# (c) 실행 중인 앱에 두 번째 책
open -a "$PWD/$APP" "$B" || fail "open -a 실패 (책 B)"
require_running "책 B"
wait_state "s.lastBook.normalize('NFC') === b" "두 번째 책으로 lastBook 이 갱신되지 않았다"
wait_state "/^epubcfi\(/.test(s.positions[b] || '')" \
  "책 B 의 위치가 기록되지 않았다 — 두 번째 책이 실제로 렌더링되지 않았다"

# (d) 회귀 가드: B 의 relocate 가 A 의 자리에 덮여 쓰이면 안 된다.
a_cfi=$(read_state "s.positions[a]")
b_cfi=$(read_state "s.positions[b]")
case "$a_cfi" in
"$SENTINEL_SECTION"*) ;;
*) fail "책 A 의 위치가 오염됐다: '$a_cfi' (기대: ${SENTINEL_SECTION}…) — 새 책의 relocate 가 옛 책 경로로 귀속됐다" ;;
esac

echo "OK(C9): 실앱 종단 검증"
echo "  이어보기+복원: A 를 $a_cfi 에서 재개"
echo "  두 번째 책:    B 를 $b_cfi 에서 시작, lastBook 갱신됨"
echo "  A 의 위치는 오염되지 않음"
