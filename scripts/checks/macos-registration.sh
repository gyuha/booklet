#!/usr/bin/env bash
# C5 — epub 핸들러 등록이 "무해"한지 확인한다.
#   (a) Info.plist 에 Viewer 역할로만 선언되어 있는가
#   (b) 기본 핸들러가 베이스라인(Readest 2)에서 바뀌지 않았는가
#   (c) booklet 이 핸들러 목록에 실제로 등록되었는가  ← /Applications 설치 후 통과
set -uo pipefail
cd "$(dirname "$0")/../.."

APP="src-tauri/target/release/bundle/macos/booklet.app"
PLIST="$APP/Contents/Info.plist"
BASELINE_DEFAULT="com.bilingify.readest"
OUR_ID="com.gyuha.booklet"

fail() {
  echo "FAIL(C5): $*" >&2
  exit 1
}

[ -d "$APP" ] || fail "빌드 산출물이 없다: $APP"

# (a) 선언이 Viewer 인가
role=$(plutil -extract CFBundleDocumentTypes.0.CFBundleTypeRole raw "$PLIST" 2>/dev/null) ||
  fail "Info.plist 에 CFBundleDocumentTypes 가 없다 (Tauri 가 src-tauri/Info.plist 를 병합하지 못했을 수 있음)"
[ "$role" = "Viewer" ] || fail "CFBundleTypeRole 이 Viewer 가 아니라 '$role' 이다"

uti=$(plutil -extract CFBundleDocumentTypes.0.LSItemContentTypes.0 raw "$PLIST" 2>/dev/null) ||
  fail "LSItemContentTypes 가 없다"
[ "$uti" = "org.idpf.epub-container" ] || fail "선언된 UTI 가 '$uti' 이다"

# (b),(c) LaunchServices 실제 상태
probe=$(swift scripts/checks/ls-probe.swift 2>/dev/null) || fail "LaunchServices 조회 실패"
current_default=$(echo "$probe" | sed -n 's/^default://p')
all_handlers=$(echo "$probe" | sed -n 's/^all://p')

[ "$current_default" = "$BASELINE_DEFAULT" ] ||
  fail "epub 기본 핸들러가 '$BASELINE_DEFAULT' 에서 '$current_default' 로 바뀌었다 — Finder 표지 회귀 위험"

case ",$all_handlers," in
*",$OUR_ID,"*) ;;
*) fail "$OUR_ID 가 epub 핸들러로 등록되지 않았다 (현재: $all_handlers) — /Applications 설치가 아직이면 정상" ;;
esac

echo "OK(C5): role=Viewer · 기본핸들러=$current_default(불변) · booklet 등록됨"
