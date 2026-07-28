#!/usr/bin/env bash
# C4 — 상태 영속성 Rust 단위 테스트.
#
# `cargo test` 는 테스트가 0개여도 exit 0 이라 그대로 쓰면 공허하게 통과한다.
# 실제로 3개 이상(왕복 / 손상 JSON / 없는 파일)이 실행됐는지까지 확인한다.
set -uo pipefail
cd "$(dirname "$0")/../.."

REQUIRED=3

fail() {
  echo "FAIL(C4): $*" >&2
  exit 1
}

out=$(cargo test --manifest-path src-tauri/Cargo.toml 2>&1) || {
  echo "$out" | tail -20
  fail "cargo test 실패"
}

count=$(echo "$out" | grep -oE '^running [0-9]+ test' | grep -oE '[0-9]+' |
  awk '{s+=$1} END {print s+0}')

[ "$count" -ge "$REQUIRED" ] ||
  fail "상태 영속성 테스트가 ${REQUIRED}개 미만 (실행된 테스트: ${count}개) — part 2/2 미완료"

echo "OK(C4): 상태 영속성 테스트 ${count}개 통과"
