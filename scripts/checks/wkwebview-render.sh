#!/usr/bin/env bash
# C8 래퍼 — vite 개발 서버를 (필요하면) 띄우고 WKWebView 하네스를 돌린 뒤 정리한다.
set -uo pipefail
cd "$(dirname "$0")/../.."

PORT=1420
URL="http://localhost:$PORT/check.html"
LOG="${TMPDIR:-/tmp}/booklet-c8-vite.log"
started=0
VITE_PID=""

up() { curl -s -o /dev/null --max-time 2 "$URL"; }

if ! up; then
  pnpm dev >"$LOG" 2>&1 &
  VITE_PID=$!
  started=1
  for _ in $(seq 1 40); do
    up && break
    sleep 1
  done
  if ! up; then
    echo "FAIL(C8): vite 개발 서버가 뜨지 않았다. 로그: $LOG" >&2
    kill "$VITE_PID" 2>/dev/null
    exit 1
  fi
fi

# 샘플이 실제로 서빙되는지 먼저 확인한다 — 하네스가 fetch 로 가져간다.
for f in a b; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:$PORT/fixtures/$f.epub")
  if [ "$code" != "200" ]; then
    echo "FAIL(C8): /fixtures/$f.epub → HTTP $code (샘플 epub 경로를 확인하라)" >&2
    [ "$started" -eq 1 ] && kill "$VITE_PID" 2>/dev/null
    exit 1
  fi
done

swift scripts/checks/wkwebview-render.swift "$URL"
rc=$?

if [ "$started" -eq 1 ]; then
  kill "$VITE_PID" 2>/dev/null
fi
exit $rc
