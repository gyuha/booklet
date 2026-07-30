# 리디바탕 (RIDIBatang)

이 디렉터리의 `RIDIBatang.woff2` 는 booklet 이 본문 기본 글꼴로 쓰기 위해 함께 담아 배포하는
서드파티 글꼴이다. booklet 의 저작물이 아니다.

- **글꼴 이름**: 리디바탕 (RIDIBatang), Regular 1종
- **저작권**: Copyright © 2019 RIDI & Sandoll. All rights reserved.
- **디자인**: Sandoll Inc. — RIDI: 김진우, 김승범, 김도훈, 조윤진 · Sandoll: 안효진, 강민재, 김초롱, 이도희, 이수현
- **배포처**: 리디주식회사 <https://ridicorp.com/ridibatang/>
- **라이선스**: SIL Open Font License, Version 1.1 <https://scripts.sil.org/OFL>
  - 개인·상업 목적 모두 사용 가능하며, 수정·복제·배포와 프로그램 내 임베딩이 허용된다.
  - **글꼴 파일 자체를 유료로 판매하는 것은 금지**된다.
  - 출처 표기는 의무가 아니라 권장 사항이며, 이 파일과 `README.md`, 릴리스 노트로 이행한다.

## 원본에서 바뀐 것

배포처가 제공하는 원본은 **OpenType (`.otf`, 1,453,448 B)** 이고, 이 저장소에 담긴 것은
**WOFF2 로 형식만 변환한 것 (457,228 B)** 이다. 글리프 윤곽·cmap·이름 테이블은 손대지 않았다
(글리프 12,434개, 코드포인트 12,472개로 원본과 동일함을 변환 후 확인했다).

OFL 1.1 의 "Modified Version" 정의에는 `by changing formats` 가 포함되므로 이 변환본은
OFL 상 파생물이다. 형식 변환 외의 수정은 없다. 변환은 `fonttools` 로 했다:

```sh
uvx --from "fonttools[woff]" python -c "
from fontTools.ttLib import TTFont
f = TTFont('RIDIBatang.otf'); f.flavor = 'woff2'; f.save('RIDIBatang.woff2')"
```

## 앱 안에서 불리는 이름

booklet 은 이 파일을 `@font-face` 로 **`RIDIBatang Bundled`** 라는 패밀리 이름으로 등록한다.
설치된 글꼴과 이름이 겹치지 않게 일부러 다른 이름을 쓴 것이다 — 그래야 "번들 파일이 실제로
로드됐다" 를 검증할 때 시스템에 설치된 리디바탕이 대신 만족시켜 버리는 일이 없다.
사용자에게 보이는 이름은 `리디바탕` 이다.

번들 결정의 근거와 감수한 리스크는 `.forge/adr/260730-001332-bundle-ridibatang-as-default-font.md` 에 있다.
