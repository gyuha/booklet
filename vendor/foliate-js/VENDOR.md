# 벤더링 정보

- 출처: https://github.com/johnfactotum/foliate-js
- 커밋: `78914aef4466eb960965702401634c2cb348e9b1`
- 라이선스: MIT (`LICENSE` 파일 동봉)
- 가져온 날짜: 2026-07-28

## 왜 npm이 아닌가

npm의 `foliate-js` 패키지(1.0.1)는 메인테이너가 `shmandadi`로 원저자 `johnfactotum`이 아니다.
`repository` 필드만 원본 저장소를 가리키는 제3자 재배포판이며 버전이 하나뿐이다.
공급망 위험을 피하기 위해 upstream에서 직접 커밋을 고정해 가져온다.
자세한 사유는 `.forge/adr/260728-004059-foliate-js-rendering-engine.md` 참조.

## upstream에서 제거한 것

불필요한 **파일만** 삭제했다. **남긴 소스 코드는 한 줄도 수정하지 않았다.**

- `.git/` — 벤더링본이므로 이력 불필요
- `tests/`, `rollup/`, `rollup.config.js`, `eslint.config.js`, `package-lock.json` — upstream 개발용
- **`pdf.js` + `vendor/pdfjs/` (13MB)** — booklet은 epub 전용이라 실행 경로가 닿지 않는다.
  이 둘만으로 벤더링본의 97%(13MB → 404KB)를 차지해서, 공개 저장소 히스토리에
  영구히 박히는 것을 피했다.

### ⚠️ pdf.js 제거의 결과 — Vite 스텁이 필수가 되었다

`view.js:107` 에 `await import('./pdf.js')` 가 남아 있다(소스를 안 고쳤으므로).
`pdf.js` 파일이 없으므로 **`vite.config.ts` 의 `stub-foliate-pdf` 플러그인이 없으면
빌드가 모듈 해석 실패로 깨진다.** 그 플러그인은 최적화가 아니라 필수 구성요소다.
(원래는 `pdf.js` 의 `import.meta.glob("vendor/pdfjs/*")` 가 Vite에서 빌드를 막아서
넣은 것이었고, 지금은 파일 부재까지 함께 흡수한다.)

`vendor/foliate-js/package.json` 의 `pdfjs-dist` 는 upstream 자체 빌드용
devDependency 이며 우리는 그 디렉터리에서 `npm install` 을 하지 않으므로 불활성이다.

PDF 지원이 필요해지면 아래 재클로닝으로 되돌린 뒤 스텁 플러그인을 제거하면 된다.

## 업데이트 방법

```
rm -rf vendor/foliate-js
git clone --depth 1 https://github.com/johnfactotum/foliate-js.git vendor/foliate-js
cd vendor/foliate-js && git rev-parse HEAD   # 이 파일의 커밋 해시를 갱신
rm -rf .git tests rollup rollup.config.js eslint.config.js package-lock.json
rm -rf pdf.js vendor/pdfjs                  # 13MB — 위 경고 참조
```

업데이트 후에는 반드시 `pnpm check`로 렌더링 회귀를 확인할 것.
