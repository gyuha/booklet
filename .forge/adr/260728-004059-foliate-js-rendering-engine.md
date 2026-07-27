---
author: gyuha
decided: 2026-07-28 00:40
---
# epub 렌더링은 foliate-js를 upstream에서 벤더링해 쓴다

epub 렌더링 엔진으로 사실상의 표준인 epub.js(GitHub 6.9k stars) 대신 foliate-js를 택했다. epub.js는 npm 최신 릴리스가 0.3.93 / 2022-02-16로 4년 넘게 정체되어 있고 런타임 의존성이 9개(jszip, lodash, core-js, localforage, @xmldom/xmldom 등)라, "가벼운 뷰어"라는 이 프로젝트의 목표와 정면으로 충돌한다. foliate-js는 MIT, 의존성 1개, 2026-05까지 활발히 유지보수 중이며 목차·진행률·페이지네이션을 기본 제공해 필요한 기능이 거의 공짜로 따라온다.

## 고려한 대안

- **epub.js** — 생태계와 자료가 압도적이라 막혔을 때 빠져나오기 쉽다는 실질적 이점이 있다. 정체된 릴리스와 번들 무게를 감수할 만큼은 아니라고 판단했다.
- **직접 구현** (Rust unzip + iframe + CSS multi-column) — 가장 가볍지만 페이지네이션·위치 복원·이미지/표 예외 처리 비용이 프로젝트 전체보다 커진다.

## 결과

- **npm의 `foliate-js` 패키지는 쓰지 않는다.** 해당 패키지의 메인테이너는 `shmandadi`로 원저자 `johnfactotum`이 아니며, repository 필드만 원본을 가리키는 제3자 재배포판이고 버전이 1.0.1 하나뿐이다. 대신 `github.com/johnfactotum/foliate-js`에서 특정 커밋을 고정해 소스를 벤더링한다. foliate-js는 빌드 단계 없는 ESM 소스라 이것이 원래 사용법이기도 하다.
- 대가로 업그레이드가 수동 작업이 된다. 개인용 로컬 앱이라 감수한다.
- foliate-js는 문서가 얇아 API를 알려면 소스를 읽어야 한다. 막혔을 때 검색으로 해결되지 않는다는 뜻이다.
