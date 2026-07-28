#!/usr/bin/env bash
# C7 — 빌드된 .app 이 실제로 뜨고 5초를 버티는가. 빈 창이어도 크래시는 잡힌다.
set -uo pipefail
cd "$(dirname "$0")/../.."

APP="src-tauri/target/release/bundle/macos/booklet.app"
BIN="booklet.app/Contents/MacOS/booklet"
CRASH_DIR="$HOME/Library/DiagnosticReports"

fail() {
  pkill -f "$BIN" 2>/dev/null
  echo "FAIL(C7): $*" >&2
  exit 1
}

[ -d "$APP" ] || fail "빌드 산출물이 없다: $APP"

before=$(ls "$CRASH_DIR" 2>/dev/null | grep -c '^booklet' || true)

pkill -f "$BIN" 2>/dev/null
open -n "$APP" || fail "open 실패"
sleep 5

pgrep -f "$BIN" >/dev/null || fail "5초 안에 프로세스가 사라졌다 (크래시 또는 즉시 종료)"

after=$(ls "$CRASH_DIR" 2>/dev/null | grep -c '^booklet' || true)
[ "$after" -eq "$before" ] || fail "새 크래시 리포트가 생성되었다 ($before → $after)"

pkill -f "$BIN" 2>/dev/null
echo "OK(C7): 실행 생존 (5초, 크래시 리포트 없음)"
