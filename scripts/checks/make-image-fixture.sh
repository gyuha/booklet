#!/usr/bin/env bash
# 이미지 폭 회귀를 재현하는 **합성 epub** 을 만든다 (멱등 — 이미 있으면 아무것도 안 한다).
#
# 왜 합성인가: 처음에는 사용자의 ~/Downloads 에 있던 실제 책을 픽스처로 썼는데
# 그 파일이 사라지자 체크가 깨졌다. 체크를 사용자가 언제든 옮길 수 있는 파일에
# 묶은 것이 설계 결함이었다. 이 픽스처는 저장소 안에서 생성되므로 결정적이다.
#
# 재현 조건: 책이 이미지에 **컬럼보다 큰 max-width 를 직접 지정**하는 것.
# foliate 의 setImageSize 는 "이미 설정된 max-width 는 보존" 하므로 그대로 넘친다.
set -uo pipefail
cd "$(dirname "$0")/../.."

OUT=".fixtures/image-overflow.epub"
[ -f "$OUT" ] && exit 0

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$(dirname "$OUT")"

# 1x1 투명 PNG. 폭은 width 속성으로 크게 잡고 max-width 로 캡한다 —
# 큰 이미지를 인코딩할 필요 없이 "선언된 폭이 컬럼보다 크다" 를 재현한다.
PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="

printf 'application/epub+zip' >"$WORK/mimetype"

mkdir -p "$WORK/META-INF" "$WORK/OEBPS"
cat >"$WORK/META-INF/container.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
XML

cat >"$WORK/OEBPS/content.opf" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="ko">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:booklet-image-overflow-fixture</dc:identifier>
    <dc:title>이미지 폭 회귀 픽스처</dc:title>
    <dc:language>ko</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>
XML

cat >"$WORK/OEBPS/nav.xhtml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ko">
<head><title>목차</title></head>
<body>
  <nav epub:type="toc"><ol>
    <li><a href="chapter-1.xhtml">본문</a></li>
    <li><a href="chapter-2.xhtml">넓은 이미지</a></li>
  </ol></nav>
</body>
</html>
XML

# 본문만 있는 섹션 — 목차가 2개 이상이어야 다른 체크와 형태가 같다.
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<html xmlns="http://www.w3.org/1999/xhtml" lang="ko"><head><title>본문</title></head><body>'
  for _ in $(seq 1 12); do
    echo '<p>본문 문단입니다. 페이지가 여러 장으로 나뉘도록 충분한 길이를 확보합니다. 가나다라마바사아자차카타파하.</p>'
  done
  echo '</body></html>'
} >"$WORK/OEBPS/chapter-1.xhtml"

# 회귀를 만드는 섹션: 책이 직접 과대 max-width 를 선언한다.
cat >"$WORK/OEBPS/chapter-2.xhtml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ko">
<head><title>넓은 이미지</title></head>
<body>
  <p>아래 이미지는 컬럼보다 넓게 선언되어 있습니다.</p>
  <img src="$PNG" alt="wide" width="1600" height="120"
       style="max-width: 1218px; display: block; margin: 0 auto;" />
  <p>이미지 뒤 문단.</p>
</body>
</html>
XML

# mimetype 은 반드시 첫 항목이고 무압축이어야 한다 (EPUB 규격).
(cd "$WORK" && zip -q -X -0 "$OLDPWD/$OUT" mimetype &&
  zip -q -X -r "$OLDPWD/$OUT" META-INF OEBPS) || {
  echo "FAIL: 픽스처 zip 생성 실패" >&2
  exit 1
}

echo "픽스처 생성: $OUT"
