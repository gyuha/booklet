#!/usr/bin/env bash
# GitHub 릴리스 배포. 버전을 올리고, 빌드하고, zip 을 만들어 릴리스에 올린다.
#
# 사용: task deploy            (patch)
#       task deploy -- minor   (minor / major)
#
# 배포 대상은 **본인 및 본인의 다른 맥**이다 (그릴링 결정). 서명 인증서가 없으므로
# 받은 쪽에서 quarantine 을 벗겨야 열린다 — 그 한 줄을 릴리스 노트에 자동으로 넣는다.
# 다른 사람에게 배포할 생각이라면 Developer ID + 공증($99/년)이 사실상 필수이고,
# 그건 이 스크립트의 범위가 아니다.
set -uo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:-patch}"
APP="src-tauri/target/release/bundle/macos/booklet.app"
CONF="src-tauri/tauri.conf.json"
DIST_DIR="dist-release"

# 버전이 박힌 세 곳. 하나라도 놓치면 앱과 릴리스의 버전이 갈린다.
VERSION_FILES=("package.json" "$CONF" "src-tauri/Cargo.toml")

die() {
  echo "✗ $*" >&2
  exit 1
}
step() { echo "▶ $*"; }

case "$BUMP" in
patch | minor | major) ;;
*) die "증가 단위는 patch|minor|major 중 하나여야 한다 (받은 값: $BUMP)" ;;
esac

# ─────────────────── 사전 점검 (하나라도 어긋나면 아무것도 하지 않는다) ───────────────────

step "사전 점검"
command -v gh >/dev/null || die "gh CLI 가 없다. brew install gh"
gh auth status >/dev/null 2>&1 || die "gh 인증이 안 되어 있다. gh auth login"
git remote get-url origin >/dev/null 2>&1 || die "origin 원격이 없다"

branch=$(git branch --show-current)
[ "$branch" = "main" ] || die "main 에서만 배포한다 (현재: $branch)"

[ -z "$(git status --porcelain)" ] ||
  die "커밋되지 않은 변경이 있다. 배포는 커밋된 상태에서만 한다:
$(git status --short | sed 's/^/    /')"

current=$(node -e "console.log(require('./$CONF').version)") || die "현재 버전을 읽지 못했다"
next=$(node -e "
  const [ma, mi, pa] = process.argv[1].split('.').map(Number);
  const b = process.argv[2];
  console.log(b === 'major' ? [ma + 1, 0, 0].join('.')
            : b === 'minor' ? [ma, mi + 1, 0].join('.')
            : [ma, mi, pa + 1].join('.'));
" "$current" "$BUMP") || die "다음 버전을 계산하지 못했다"
tag="v$next"

git rev-parse -q --verify "refs/tags/$tag" >/dev/null &&
  die "태그 $tag 가 이미 있다"
gh release view "$tag" >/dev/null 2>&1 &&
  die "릴리스 $tag 가 이미 있다"

echo "  $current → $next ($BUMP), 태그 $tag"

# ─────────────────── 검증 게이트 ───────────────────

step "스톱 조건 체크 (task check)"
task check || die "체크가 실패했다. 배포하지 않는다"

# ─────────────────── 버전 올리기 (실패하면 되돌린다) ───────────────────

restore_versions() {
  git checkout -- "${VERSION_FILES[@]}" 2>/dev/null
}

step "버전 올리기"
node -e "
  const fs = require('fs');
  const next = process.argv[1];
  for (const f of ['package.json', '$CONF']) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.version = next;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
  const cargo = 'src-tauri/Cargo.toml';
  const src = fs.readFileSync(cargo, 'utf8');
  const out = src.replace(/^version = \".*\"/m, \`version = \"\${next}\"\`);
  if (out === src) { console.error('Cargo.toml version 을 바꾸지 못했다'); process.exit(1) }
  fs.writeFileSync(cargo, out);
" "$next" || { restore_versions; die "버전 파일을 고치지 못했다"; }

# Cargo.lock 의 booklet 항목도 따라가야 한다 (안 하면 빌드가 lock 을 고쳐 워크트리가 더러워진다)
cargo update -p booklet --manifest-path src-tauri/Cargo.toml --offline >/dev/null 2>&1

step "릴리스 빌드"
task build || { restore_versions; die "빌드가 실패했다"; }
[ -d "$APP" ] || { restore_versions; die "빌드 산출물이 없다: $APP"; }

built=$(plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist" 2>/dev/null || true)
[ "$built" = "$next" ] ||
  { restore_versions; die "번들 버전($built)이 올린 버전($next)과 다르다"; }

step "zip 만들기"
# ditto 를 쓰는 이유: zip -r 은 .app 번들의 심볼릭 링크·메타데이터를 깨뜨린다.
rm -rf "$DIST_DIR" && mkdir -p "$DIST_DIR"
zipfile="$DIST_DIR/booklet-$next-macos-arm64.zip"
ditto -c -k --keepParent "$APP" "$zipfile" ||
  { restore_versions; die "zip 생성 실패"; }
echo "  $zipfile ($(du -h "$zipfile" | cut -f1))"

# ─────────────────── 커밋 · 태그 · 릴리스 ───────────────────

step "커밋 · 태그"
git add "${VERSION_FILES[@]}" src-tauri/Cargo.lock 2>/dev/null
git commit -q -m "chore(release): $tag" || { restore_versions; die "커밋 실패"; }
git tag -a "$tag" -m "$tag" || die "태그 생성 실패"

step "푸시"
git push origin main --follow-tags || die "푸시 실패 (커밋과 태그는 로컬에 남아 있다)"

step "릴리스 생성"
prev=$(git describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)
if [ -n "$prev" ]; then
  changes=$(git log --no-merges --pretty='- %s' "$prev..$tag^")
  range="$prev 이후"
else
  changes=$(git log --no-merges --pretty='- %s' "$tag^" | head -20)
  range="첫 릴리스"
fi

notes=$(
  cat <<NOTES
## 변경 사항 ($range)

$changes

## 설치

서명 인증서 없이 빌드했으므로 다운로드한 앱에는 quarantine 속성이 붙습니다.
압축을 풀고 \`/Applications\` 로 옮긴 뒤 아래 한 줄을 실행하세요.

\`\`\`
xattr -dr com.apple.quarantine /Applications/booklet.app
\`\`\`

epub 을 booklet 으로 열려면 Finder 에서 우클릭 → "다음으로 열기". 기본 앱 자리는
건드리지 않으므로 Finder 의 표지 썸네일은 그대로 유지됩니다.

## 글꼴

본문 기본 글꼴로 **리디바탕**을 함께 담았습니다. 리디주식회사가 SIL Open Font
License 1.1 로 배포하는 글꼴이며, 원본 OTF 를 WOFF2 로 형식만 변환했습니다.
Copyright © 2019 RIDI & Sandoll. <https://ridicorp.com/ridibatang/>
NOTES
)

gh release create "$tag" "$zipfile" --title "$tag" --notes "$notes" ||
  die "릴리스 생성 실패 (태그는 푸시되어 있다 — gh release create $tag 로 재시도 가능)"

echo ""
echo "✅ 배포 완료: $tag"
gh release view "$tag" --json url --jq .url
