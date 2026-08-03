#!/usr/bin/env bash
# 빌드된 booklet.app 을 배포용 DMG 로 굽는다. `task build` 가 빌드 직후 호출한다.
#
# **Tauri 의 DMG 번들러를 되살린 것이 아니다.** 그건 `bundle_dmg.sh` 가 AppleScript 로
# Finder 를 조작해 창 배경과 아이콘 좌표를 잡느라 플레이키했고, 실패하면 마운트된 볼륨을
# 남겼다 — 그래서 `bundle.targets` 를 `["app"]` 로 두고 껐다(CLAUDE.md). 그 결정은 유효하고,
# 여기서도 되살리지 않는다.
#
# 이 스크립트는 **`hdiutil` 만 쓴다**. Finder 자동화가 없고, `-srcfolder` 는 스테이징
# 디렉터리를 이미지에 직접 구우므로 **볼륨을 마운트하지 않는다** — 위 실패 모드가 구조적으로
# 없다. 대가는 창 배경·아이콘 좌표가 없다는 것뿐이고, 받는 쪽은 열린 창에서 booklet.app 을
# 옆의 Applications 링크로 끌어다 놓으면 된다.
set -uo pipefail
cd "$(dirname "$0")/.."

APP="src-tauri/target/release/bundle/macos/booklet.app"
DIST_DIR="dist-release"

die() {
  echo "✗ $*" >&2
  exit 1
}

command -v hdiutil >/dev/null || die "hdiutil 이 없다 (macOS 전용 스크립트)"
[ -d "$APP" ] || die "빌드 산출물이 없다: $APP — 먼저 'task build'"

# 버전은 tauri.conf.json 이 아니라 **빌드된 번들**에서 읽는다. 설정만 올리고 빌드를 안 한
# 상태에서 이름만 새 버전으로 붙는 것을 막는다 (deploy.sh 도 같은 값을 교차 확인한다).
version=$(plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist" 2>/dev/null) ||
  die "번들에서 버전을 읽지 못했다: $APP/Contents/Info.plist"

out="$DIST_DIR/booklet-$version-macos-arm64.dmg"

# ditto 를 쓰는 이유는 zip 때와 같다 — cp 는 .app 번들의 심볼릭 링크·메타데이터를 깨뜨린다.
stage=$(mktemp -d) || die "스테이징 디렉터리를 만들지 못했다"
trap 'rm -rf "$stage"' EXIT
ditto "$APP" "$stage/booklet.app" || die "앱 복사 실패"
ln -s /Applications "$stage/Applications" || die "Applications 링크 생성 실패"

mkdir -p "$DIST_DIR"
rm -f "$out"
hdiutil create \
  -volname "booklet $version" \
  -srcfolder "$stage" \
  -format UDZO \
  -fs HFS+ \
  -quiet \
  "$out" || die "DMG 생성 실패"

# 굽고 끝내지 않는다 — 체크섬까지 확인해야 "만들어졌다"가 "열린다"를 뜻한다.
hdiutil verify "$out" >/dev/null 2>&1 || die "DMG 검증 실패(체크섬): $out"

echo "OK(dmg): $out ($(du -h "$out" | cut -f1))"
