#!/usr/bin/env bash
# C1 보조 — 번들 글꼴이 **패키징된 앱 안에** 실려 나가는지 본다.
#
# 왜 필요한가: C3·C8 은 vite dev 서버에서 돌고 C9 는 실앱을 쓰지만 글꼴을 보지 않는다.
# 그래서 이 단언이 없으면 에셋이 번들에서 빠져도 C1–C9 가 전부 통과하고, 개발에서는
# 멀쩡한데 **배포한 앱에만 글꼴이 없는** 상태가 조용히 나간다.
#
# Tauri v2 는 프론트엔드를 실행 바이너리에 임베드한다(Resources/ 에는 icon.icns 뿐).
# 따라서 파일 존재가 아니라 바이너리 안의 WOFF2 시그니처(`wOF2`)를 찾는다.
#
# cwd 드리프트로 헛된 "no such file" 을 만든 전례가 있어 경로는 레포 루트 기준 절대 경로로 만든다.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bin="$root/src-tauri/target/release/bundle/macos/booklet.app/Contents/MacOS/booklet"
src="$root/src/assets/RIDIBatang.woff2"

fail() {
  echo "FAIL(C1-font): $1" >&2
  exit 1
}

[ -f "$bin" ] || fail "실행 바이너리가 없다: $bin"
[ -f "$src" ] || fail "원본 글꼴이 없다: $src"

expected=$(wc -c <"$src" | tr -d ' ')

# 바이너리에서 wOF2 시그니처를 찾고, 그 지점의 WOFF2 헤더가 선언한 길이를 읽어
# 원본 크기와 대조한다. 시그니처 존재만 보면 잘린 에셋을 통과시킨다.
python3 - "$bin" "$expected" <<'PY'
import struct
import sys

path, expected = sys.argv[1], int(sys.argv[2])
data = open(path, "rb").read()

at = data.find(b"wOF2")
if at < 0:
    sys.exit(
        f"FAIL(C1-font): 바이너리에 WOFF2 시그니처가 없다 — 글꼴이 번들에서 빠졌다 "
        f"(바이너리 {len(data)} bytes)"
    )

# WOFF2 헤더: signature(4) flavor(4) length(4) numTables(2) ...
# length 는 파일 전체 길이다.
(length,) = struct.unpack(">I", data[at + 8 : at + 12])
if length != expected:
    sys.exit(
        f"FAIL(C1-font): 임베드된 글꼴 길이가 원본과 다르다 "
        f"(임베드 {length} != 원본 {expected}) — 에셋이 잘렸거나 다른 파일이다"
    )

print(f"OK(C1-font): 번들 글꼴 임베드 확인 — {length} bytes @ offset {at}")
PY
