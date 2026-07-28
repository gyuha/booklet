#!/usr/bin/env bash
# C6 — foliate-js 가 upstream 에서 커밋 고정으로 벤더링되어 있고,
#      npm 의 제3자 재배포판에 의존하지 않는지 확인한다.
set -uo pipefail
cd "$(dirname "$0")/../.."

fail() {
  echo "FAIL(C6): $*" >&2
  exit 1
}

for f in view.js epub.js paginator.js LICENSE VENDOR.md; do
  [ -f "vendor/foliate-js/$f" ] || fail "vendor/foliate-js/$f 가 없다"
done

grep -qE '\`[0-9a-f]{40}\`' vendor/foliate-js/VENDOR.md ||
  fail "VENDOR.md 에 40자 커밋 해시 기록이 없다"

node -e '
const p = require("./package.json");
const dep = (p.dependencies && p.dependencies["foliate-js"]) ||
            (p.devDependencies && p.devDependencies["foliate-js"]);
if (dep) { console.error("npm foliate-js 의존성 발견: " + dep); process.exit(1) }
' || fail "package.json 이 npm foliate-js 에 의존하고 있다"

echo "OK(C6): 벤더링 무결성 — $(grep -oE '[0-9a-f]{40}' vendor/foliate-js/VENDOR.md | head -1)"
