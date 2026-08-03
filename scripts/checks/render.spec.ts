import { test, expect, type Frame, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

// 검증용 샘플. 환경변수로 바꿀 수 있게 해 두되, 체크를 통과시키려고
// 더 쉬운 파일로 갈아끼우는 용도가 아니라 다른 머신에서 돌리기 위한 것이다.
const SAMPLE =
  process.env.BOOKLET_SAMPLE_EPUB ??
  `${homedir()}/Downloads/내면 근력 결국 멘탈 게임이다.epub`;

const SAMPLE2 =
  process.env.BOOKLET_SAMPLE_EPUB2 ??
  `${homedir()}/Downloads/신 퇴마록 신세편 1.epub`;

/** 본문은 paginator 가 만든 iframe 안에 있다. 가장 텍스트가 많은 프레임을 고른다. */
async function contentText(page: Page): Promise<string> {
  const texts = await Promise.all(
    page
      .frames()
      .filter((f: Frame) => f !== page.mainFrame())
      .map((f: Frame) =>
        f.evaluate(() => document.body?.textContent ?? "").catch(() => ""),
      ),
  );
  return texts.sort((a, b) => b.length - a.length)[0] ?? "";
}

const lastCfi = (page: Page) =>
  page.evaluate(() => (window as any).check.locations.at(-1)?.cfi ?? null);

const goTo = (page: Page, href: string) =>
  page.evaluate((h) => (window as any).check.reader.goTo(h), href);

test("foliate-js 가 epub 을 렌더링하고 페이지 넘김·목차 이동이 동작한다", async ({
  page,
}) => {
  expect(existsSync(SAMPLE), `샘플 epub 이 없다: ${SAMPLE}`).toBe(true);

  await page.goto("/check.html");
  await page.setInputFiles("#file", SAMPLE);
  await expect
    .poll(() => page.evaluate(() => (window as any).check.opened), {
      timeout: 60_000,
    })
    .toBe(true);

  // (a) 목차가 파싱되었는가
  const toc: { label: string; href: string }[] = await page.evaluate(() =>
    (window as any).check
      .toc()
      .map((i: any) => ({ label: i.label, href: i.href })),
  );
  expect(toc.length, "목차 항목이 2개 미만").toBeGreaterThanOrEqual(2);

  // (b) 초기 오픈만으로 렌더 파이프라인이 실제로 돌았는가.
  //     첫 섹션은 표지 페이지라 본문 텍스트가 없는 게 정상이므로,
  //     "빈 창"과 구별하려면 CFI 가 생성되었는지를 본다.
  await expect
    .poll(() => lastCfi(page), { timeout: 30_000 })
    .toEqual(expect.stringContaining("epubcfi("));

  // (c) 본문이 실제로 그려지는가.
  //     표지·구분 페이지는 텍스트가 거의 없으므로 목차를 순회해
  //     산문이 있는 섹션을 찾는다. 하나도 없으면 렌더링 실패다.
  let proseHref: string | null = null;
  let proseText = "";
  for (const item of toc.slice(0, 10)) {
    await goTo(page, item.href);
    await expect
      .poll(async () => (await contentText(page)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(0);
    const t = await contentText(page);
    if (t.length >= 200) {
      proseHref = item.href;
      proseText = t;
      break;
    }
  }
  expect(
    proseHref,
    "목차 앞 10개 항목 어디에서도 본문 200자를 렌더링하지 못했다 — 빈 창일 가능성",
  ).not.toBeNull();

  // (d) 페이지가 실제로 넘어가는가.
  //     페이지네이션은 CSS 다단을 가로 스크롤하므로 DOM 텍스트는 그대로다.
  //     따라서 relocate 이벤트의 CFI 변화로 판정한다.
  const cfiBefore = await lastCfi(page);
  await page.evaluate(() => (window as any).check.reader.goRight());
  await expect
    .poll(() => lastCfi(page), { timeout: 30_000 })
    .not.toBe(cfiBefore);

  // (f) 본문을 클릭하면 포커스가 섹션 iframe 안으로 들어간다. 그 뒤에도
  //     키보드 페이지 넘김이 동작해야 한다.
  //     — 실제로 발생한 회귀다. 키 핸들러를 최상위 window 에만 붙였더니
  //       본문을 한 번 클릭한 뒤로는 ←/→ 가 완전히 죽었다.
  const viewport = page.viewportSize()!;
  await page.mouse.click(
    Math.round(viewport.width / 2),
    Math.round(viewport.height / 2),
  );
  const cfiAfterClick = await lastCfi(page);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => lastCfi(page), { timeout: 15_000 })
    .not.toBe(cfiAfterClick);

  // (e) 다른 섹션으로 이동하면 다른 본문이 로드되는가
  const base = (href: string) => href.split("#")[0];
  const other = toc
    .slice(0, 12)
    .find((i) => base(i.href) !== base(proseHref as string));
  expect(other, "비교할 다른 섹션을 찾지 못했다").toBeTruthy();
  await goTo(page, other!.href);
  await expect
    .poll(() => contentText(page), { timeout: 30_000 })
    .not.toBe(proseText);
});

// 두 번째 책 열기. 실제로 발생한 회귀다 —
// foliate 의 view.open() 은 기존 renderer 를 정리하지 않고 새로 append 만 하므로,
// close() 없이 두 번 열면 옛 renderer 가 DOM 에 남아 옛 책을 계속 보여준다.
// 사용자에게는 "책이 열린 상태에서는 드래그앤드롭이 안 된다"로 보였다.
test("두 번째 책을 열면 이전 책이 교체된다", async ({ page }) => {
  expect(existsSync(SAMPLE), `샘플 epub 이 없다: ${SAMPLE}`).toBe(true);
  expect(existsSync(SAMPLE2), `두 번째 샘플 epub 이 없다: ${SAMPLE2}`).toBe(true);

  const contentFrames = () => page.frames().length - 1;
  const tocLabels = () =>
    page.evaluate(() =>
      (window as any).check.toc().map((i: any) => `${i.label}|${i.href}`),
    );

  await page.goto("/check.html");

  await page.setInputFiles("#file", SAMPLE);
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);
  await expect.poll(contentFrames, { timeout: 15_000 }).toBe(1);
  const tocA = await tocLabels();

  await page.setInputFiles("#file", SAMPLE2);
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(2);

  // 핵심: 옛 renderer 가 남아있지 않다. 남아있으면 콘텐츠 iframe 이 2개가 된다.
  await expect
    .poll(contentFrames, { timeout: 15_000 })
    .toBe(1);

  // 그리고 실제로 두 번째 책의 목차로 바뀌었다.
  const tocB = await tocLabels();
  expect(tocB.length, "두 번째 책의 목차가 비었다").toBeGreaterThanOrEqual(2);
  expect(tocB, "두 번째 책을 열었는데 목차가 그대로다").not.toEqual(tocA);
});

// 읽던 위치 복원 (part 2/2 S4). view.init({lastLocation}) 이 CFI 를 실제로
// 해석해 그 섹션으로 돌아가는지 확인한다. CFI 는 페이지 단위로 미세하게 달라질 수
// 있으므로 "!" 앞의 **섹션 경로**가 일치하는지로 판정한다.
test("읽던 위치를 CFI 로 복원한다", async ({ page }) => {
  const section = (cfi: string) => cfi.split("!")[0];

  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);

  // 첫 섹션(표지)이 아닌 곳으로 이동해 복원할 지점을 만든다.
  await expect.poll(() => lastCfi(page), { timeout: 30_000 }).not.toBeNull();
  const initial = (await lastCfi(page)) as string;

  const toc: { href: string }[] = await page.evaluate(() =>
    (window as any).check.toc().map((i: any) => ({ href: i.href })),
  );
  const base = (h: string) => h.split("#")[0];
  const target = toc.find((i) => base(i.href) !== base(toc[0].href));
  expect(target, "이동할 다른 섹션이 없다").toBeTruthy();
  await goTo(page, target!.href);

  await expect
    .poll(
      async () => {
        const c = await lastCfi(page);
        return c && section(c) !== section(initial) ? c : null;
      },
      { timeout: 30_000 },
    )
    .not.toBeNull();
  const saved = (await lastCfi(page)) as string;

  // 같은 책을 그 지점으로 다시 연다.
  await page.evaluate(
    (cfi) => (window as any).check.openUrl("/fixtures/a.epub", cfi),
    saved,
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(2);

  await expect
    .poll(
      async () => {
        const c = await lastCfi(page);
        return c && section(c) === section(saved) ? c : null;
      },
      { timeout: 30_000 },
    )
    .not.toBeNull();

  const restored = (await lastCfi(page)) as string;
  expect(
    section(restored),
    `복원 위치의 섹션이 저장 위치와 다르다: ${restored} vs ${saved}`,
  ).toBe(section(saved));
});

// 글꼴 크기 조절 (part 2/2 S3). reader.setFontScale 이 주입 스타일을 실제로 바꿔
// 본문 문서의 계산된 font-size 가 커지는지 확인한다.
// (Playwright 는 shadow DOM 을 넘어 iframe 에 접근할 수 있어 이 단언이 가능하다.
//  WKWebView 하네스에서는 closed shadow root 때문에 불가능하므로 C8 에는 없다.)
test("글꼴 배율이 본문에 실제로 반영된다", async ({ page }) => {
  const htmlFontSize = async () => {
    const frames = page.frames().filter((f) => f !== page.mainFrame());
    const sizes = await Promise.all(
      frames.map((f) =>
        f
          .evaluate(
            () =>
              parseFloat(
                getComputedStyle(document.documentElement).fontSize || "0",
              ) || 0,
          )
          .catch(() => 0),
      ),
    );
    return Math.max(0, ...sizes);
  };

  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);

  await expect.poll(htmlFontSize, { timeout: 30_000 }).toBeGreaterThan(0);
  const base = await htmlFontSize();

  await page.evaluate(() => (window as any).check.setTypography({ fontScale: 1.6 }));
  await expect
    .poll(htmlFontSize, { timeout: 30_000 })
    .toBeGreaterThan(base * 1.3);

  await page.evaluate(() => (window as any).check.setTypography({ fontScale: 1 }));
  await expect
    .poll(htmlFontSize, { timeout: 30_000 })
    .toBeLessThan(base * 1.1);
});

// 마우스 휠로 페이지 넘김. 키보드와 같은 함정이 있다 — 본문은 섹션 iframe 이라
// 커서가 본문 위에 있으면 최상위 문서에는 wheel 이 도달하지 않는다.
// 그래서 (1) 본문 위에서 굴리기 (2) 클릭해 포커스를 iframe 으로 옮긴 뒤 굴리기
// 두 경우를 모두 확인한다.
test("마우스 휠로 이전/다음 페이지로 이동한다", async ({ page }) => {
  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);
  await expect.poll(() => lastCfi(page), { timeout: 30_000 }).not.toBeNull();

  const viewport = page.viewportSize()!;
  const cx = Math.round(viewport.width / 2);
  const cy = Math.round(viewport.height / 2);

  // 본문 한가운데로 커서를 옮긴다 — 이래야 wheel 이 섹션 iframe 으로 간다.
  await page.mouse.move(cx, cy);

  // (1) 아래로 굴리면 다음 페이지
  const before = await lastCfi(page);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => lastCfi(page), { timeout: 15_000 }).not.toBe(before);
  const afterDown = (await lastCfi(page)) as string;

  // 쿨다운(300ms)이 지나야 다음 입력이 먹는다.
  await page.waitForTimeout(500);

  // (2) 위로 굴리면 이전 페이지 — 되돌아와야 한다
  await page.mouse.wheel(0, -120);
  await expect
    .poll(() => lastCfi(page), { timeout: 15_000 })
    .not.toBe(afterDown);

  // (3) 본문을 클릭해 포커스가 iframe 으로 들어간 뒤에도 휠이 동작해야 한다
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(500);
  const afterClick = await lastCfi(page);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(() => lastCfi(page), { timeout: 15_000 })
    .not.toBe(afterClick);

  // (4) **작은 델타 한 번으로도 넘어가야 한다.** 노치당 deltaY 는 장치마다 크게 다르고,
  //     예전의 누적 임계값(60)에서는 작은 값을 주는 마우스로 십여 번을 굴려야 한 장이
  //     넘어갔다(사람 UAT 보고). 10 은 그 임계값보다 훨씬 작으므로, 누적 방식으로
  //     되돌리면 이 단언이 깨진다.
  await page.waitForTimeout(500);
  const beforeSmall = await lastCfi(page);
  await page.mouse.wheel(0, 10);
  await expect
    .poll(() => lastCfi(page), { timeout: 15_000 })
    .not.toBe(beforeSmall);

  // (5) 가로 스크롤은 페이지를 넘기지 않는다 (deltaY≈0 이면 방향도 정할 수 없다).
  await page.waitForTimeout(500);
  const beforeSide = await lastCfi(page);
  const sideCount = await page.evaluate(
    () => (window as any).check.locations.length,
  );
  await page.mouse.wheel(120, 0);
  await page.waitForTimeout(700);
  expect(
    await page.evaluate(() => (window as any).check.locations.length),
    "가로로만 굴렸는데 페이지가 넘어갔다",
  ).toBe(sideCount);
  expect(await lastCfi(page), "가로 스크롤로 위치가 변했다").toBe(beforeSide);
});

// 자체 스크롤을 가진 앱 크롬(실앱의 목차 패널) 위에서는 휠이 페이지를 넘기지 말고
// 그 요소를 스크롤해야 한다. 실제로 발생한 회귀 — 휠을 최상위 문서에 붙이면서
// 커서 위치를 보지 않아 목차 패널 위에서도 페이지가 넘어갔다.
test("앱 크롬 위에서는 휠이 페이지를 넘기지 않고 그 요소를 스크롤한다", async ({
  page,
}) => {
  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);
  await expect.poll(() => lastCfi(page), { timeout: 30_000 }).not.toBeNull();

  const scrollTop = () =>
    page.evaluate(
      () => document.querySelector<HTMLElement>("#chrome")!.scrollTop,
    );

  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#chrome")!.hidden = false;
  });

  // 크롬 영역 안쪽(폭 220px)으로 커서를 옮긴다.
  await page.mouse.move(110, 300);
  const cfiBefore = await lastCfi(page);
  const scrollBefore = await scrollTop();

  await page.mouse.wheel(0, 300);
  await expect
    .poll(scrollTop, { timeout: 10_000 })
    .toBeGreaterThan(scrollBefore);

  expect(
    await lastCfi(page),
    "앱 크롬 위에서 굴렸는데 페이지가 넘어갔다",
  ).toBe(cfiBefore);
});

// 타이포그래피 설정이 본문에 실제로 반영되는가 (part 3 S2/S5).
// 여백은 CSS 가 아니라 paginator 속성이라 계산 스타일로 안 잡힌다 —
// 여백이 늘면 컨테이너가 좁아져 **column-width 가 줄어드는** 것으로 관측한다.
test("타이포그래피 설정이 본문에 반영된다", async ({ page }) => {
  const bodyStyles = async () => {
    const frames = page.frames().filter((f) => f !== page.mainFrame());
    for (const f of frames) {
      const v = await f
        .evaluate(() => {
          const p = document.querySelector("p");
          if (!p || (document.body.textContent ?? "").length < 200) return null;
          const s = getComputedStyle(p);
          const root = getComputedStyle(document.documentElement);
          return {
            lineHeight: parseFloat(s.lineHeight) || 0,
            letterSpacing: parseFloat(s.letterSpacing) || 0,
            fontFamily: s.fontFamily,
            columnWidth: parseFloat(root.columnWidth) || 0,
          };
        })
        .catch(() => null);
      if (v) return v;
    }
    return null;
  };

  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);

  // 산문 섹션으로 이동해 <p> 가 있는 상태를 만든다.
  const toc: { href: string }[] = await page.evaluate(() =>
    (window as any).check.toc().map((i: any) => ({ href: i.href })),
  );
  for (const item of toc.slice(0, 10)) {
    await goTo(page, item.href);
    await page.waitForTimeout(400);
    if (await bodyStyles()) break;
  }
  await expect.poll(bodyStyles, { timeout: 30_000 }).not.toBeNull();
  const before = (await bodyStyles())!;

  // 설치된 실제 글꼴 하나를 골라 함께 적용한다.
  const fonts: { label: string; family: string | null }[] = await page.evaluate(
    () => (window as any).check.availableFonts(),
  );
  const realFont = fonts.find((f) => f.family)?.family ?? null;

  await page.evaluate(
    (family) =>
      (window as any).check.setTypography({
        lineHeight: 2.4,
        letterSpacing: 0.1,
        margin: 160,
        fontFamily: family,
      }),
    realFont,
  );

  await expect
    .poll(async () => (await bodyStyles())?.lineHeight ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(before.lineHeight * 1.2);

  const after = (await bodyStyles())!;
  expect(after.letterSpacing, "자간이 반영되지 않았다").toBeGreaterThan(0.5);
  expect(
    after.columnWidth,
    "여백을 늘렸는데 컬럼 폭이 줄지 않았다 (paginator margin 속성 미반영)",
  ).toBeLessThan(before.columnWidth);
  if (realFont) {
    expect(after.fontFamily, "글꼴 지정이 반영되지 않았다").toContain(realFont);
  }
});

// "굵게" 설정. 슬라이더가 아니라 토글인 이유는 reader.ts 의 Typography.bold 주석에 있다 —
// 번들 글꼴이 단일 웨이트라 굵기가 **엔진의 합성 볼드**에서 나오고, 실앱 엔진에서 재 보니
// 100·300·400 / 600·700·900 두 덩어리로만 갈렸다.
//
// **끈 상태에서 400 을 강제하지 않는지도 함께 본다.** 강제하면 책이 지정한 제목·강조의
// 굵기까지 눌린다 — 그래서 끄면 아무 규칙도 주입하지 않는 것이 맞고, 그 경우 본문은
// 책이 정한 값(대개 400)을 그대로 쓴다.
test("굵게 설정이 본문에 반영되고 끄면 되돌아온다", async ({ page }) => {
  const bodyWeight = async () => {
    const frames = page.frames().filter((f) => f !== page.mainFrame());
    for (const f of frames) {
      const v = await f
        .evaluate(() => {
          const p = document.querySelector("p");
          if (!p || (document.body.textContent ?? "").length < 200) return null;
          // **우리가 주입한 시트**를 찾아 거기에 굵기 규칙이 있는지 본다.
          // `700` 문자열만 찾으면 "끈 상태에서 400 을 강제하는" 회귀를 못 잡는다
          // (실제로 무력화 테스트에서 통과해 버려 이 방식으로 바꿨다).
          // 우리 시트는 번들 글꼴 @font-face 를 담고 있어 책 CSS 와 구별된다.
          const ourSheet = Array.from(document.styleSheets).find((sh) => {
            try {
              return Array.from(sh.cssRules).some((r) =>
                /RIDIBatang Bundled/.test((r as CSSRule).cssText ?? ""),
              );
            } catch {
              return false;
            }
          });
          if (!ourSheet) return null; // 주입 시트를 못 찾으면 판정하지 않는다
          return {
            weight: getComputedStyle(p).fontWeight,
            injected: Array.from(ourSheet.cssRules).some((r) =>
              /font-weight/i.test((r as CSSRule).cssText ?? ""),
            ),
          };
        })
        .catch(() => null);
      if (v) return v;
    }
    return null;
  };

  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);

  const toc: { href: string }[] = await page.evaluate(() =>
    (window as any).check.toc().map((i: any) => ({ href: i.href })),
  );
  for (const item of toc.slice(0, 10)) {
    await goTo(page, item.href);
    await page.waitForTimeout(400);
    if (await bodyWeight()) break;
  }
  await expect.poll(bodyWeight, { timeout: 30_000 }).not.toBeNull();

  // (a) 기본값은 꺼짐 — 굵기 규칙을 **아예** 주입하지 않는다(400 강제도 안 된다).
  const off = (await bodyWeight())!;
  expect(
    off.injected,
    "굵게가 꺼졌는데 주입 시트에 font-weight 규칙이 있다 — 책이 정한 제목·강조 굵기를 누른다",
  ).toBe(false);

  // (b) 켜면 본문 계산 굵기가 700 이 된다.
  await page.evaluate(() => (window as any).check.setTypography({ bold: true }));
  await expect
    .poll(async () => (await bodyWeight())?.weight, { timeout: 20_000 })
    .toBe("700");
  expect((await bodyWeight())!.injected, "켰는데 굵기 규칙이 없다").toBe(true);

  // (c) 끄면 규칙이 사라지고 굵기가 되돌아온다.
  await page.evaluate(() => (window as any).check.setTypography({ bold: false }));
  await expect
    .poll(async () => (await bodyWeight())?.injected, { timeout: 20_000 })
    .toBe(false);
  expect(
    (await bodyWeight())!.weight,
    "껐는데 본문 굵기가 원래대로 돌아오지 않았다",
  ).toBe(off.weight);
});

// 읽기 진행률 인디게이터가 하단에서 실제로 갱신되는가.
//
// 인디게이터는 앱 크롬이라 이 하네스에서는 `check.html` 의 대역을 본다. 다만 갱신은
// **앱과 같은 `src/progress.ts` 함수**를 호출하므로 검증되는 것은 실물 로직이다.
// 스타일(3px·하단 가장자리·회색조·헤일로)은 styles.css 에만 있어 여기서 보이지 않는다 —
// 배치와 색은 사람 UAT 담당이고, 여기서는 fraction → (바 폭, 텍스트, 표시 여부)만 본다.
test("읽기 진행률 인디게이터가 하단에서 갱신된다", async ({ page }) => {
  /** 바 폭(%)과 퍼센트 텍스트를 함께 읽는다. 둘은 같은 정수여야 한다. */
  const indicator = () =>
    page.evaluate(() => {
      const box = document.querySelector<HTMLElement>("#progress")!;
      const fill = document.querySelector<HTMLElement>("#progress-fill")!;
      const pct = document.querySelector<HTMLElement>("#progress-pct")!;
      return {
        hidden: box.hidden,
        width: fill.style.width,
        text: pct.textContent ?? "",
      };
    });

  await page.goto("/check.html");

  // (c) 책을 열기 전에는 보이지 않는다.
  expect(
    (await indicator()).hidden,
    "책이 없는데 진행률 인디게이터가 보인다",
  ).toBe(true);

  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);
  await expect.poll(() => lastCfi(page), { timeout: 30_000 }).not.toBeNull();

  const first = await indicator();
  expect(first.hidden, "책을 열었는데 인디게이터가 숨어 있다").toBe(false);
  expect(first.width, "바 폭이 설정되지 않았다 (갱신이 돌지 않음)").toMatch(
    /^\d+%$/,
  );
  expect(
    first.text,
    "퍼센트 텍스트가 바 폭과 다르다",
  ).toBe(first.width);

  // (a) 뒤쪽 섹션으로 이동하면 진행률이 커진다.
  //     첫 몇 페이지 넘김은 반올림 후 0%→1% 라 판정이 무르다. 목차로 크게 건너뛴다.
  const toc: { href: string }[] = await page.evaluate(() =>
    (window as any).check.toc().map((i: any) => ({ href: i.href })),
  );
  const later =
    toc[Math.floor(toc.length * 0.75)] ?? toc[Math.max(0, toc.length - 1)];
  await goTo(page, later.href);
  await expect
    .poll(async () => parseInt((await indicator()).width, 10), {
      timeout: 20_000,
    })
    .toBeGreaterThan(parseInt(first.width, 10));

  const mid = await indicator();
  expect(mid.text, "이동 후 퍼센트 텍스트가 바 폭과 어긋났다").toBe(mid.width);

  // (b) 책의 끝에서 100% 에 근접한다. 본문에 포커스를 준 뒤 End.
  const viewport = page.viewportSize()!;
  await page.mouse.click(
    Math.round(viewport.width / 2),
    Math.round(viewport.height / 2),
  );
  await page.waitForTimeout(400);
  await page.keyboard.press("End");
  await expect
    .poll(async () => parseInt((await indicator()).width, 10), {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(95);
});

// 번들한 기본 본문 글꼴(리디바탕)이 실제로 로드되어 본문에 적용되는가.
//
// **단언 설계에 함정이 둘 있어 프로브로 확인하고 고쳤다. 손대기 전에 읽어라.**
//  1. `document.fonts.check()` 는 쓸 수 없다. "그 글꼴이 있는가" 가 아니라 "이 문자들을
//     렌더할 수 있는가" 를 답하므로 폴백으로도 참이 된다 — 실측: 존재하지 않는 이름에도
//     `true` 를 돌려줬다. 대신 **`FontFaceSet` 항목의 `status`** 를 본다.
//  2. 폭 측정 span 에는 **인라인 `!important`** 가 필요하다. 주입 규칙이
//     `span { font-family: ... !important }` 라서 보통의 인라인 선언은 진다 — 이걸 놓치면
//     네 후보의 폭이 전부 같게 나와(실측 1228.61 ×4) 아무것도 구별하지 못한다.
//
// 개발 머신에는 리디바탕이 **이미 설치돼 있다.** 그래서 `@font-face` 패밀리 이름을 설치
// 글꼴과 겹치지 않는 `RIDIBatang Bundled` 로 둔 것이 이 체크가 공허해지지 않는 이유다 —
// 그 이름이 로드됐다는 건 번들 파일에서 왔다는 것 외에 해석이 없다. 이름을 `리디바탕` 으로
// 바꾸면 번들 로드가 실패해도 시스템 설치본이 대신 통과시킨다.
const BUNDLED_FAMILY = "RIDIBatang Bundled";

test("번들한 기본 본문 글꼴이 로드되어 본문에 적용된다", async ({ page }) => {
  /** 본문 프레임(텍스트가 가장 많은 프레임)에서 로드 상태와 폭 대조를 읽는다. */
  const probe = async () => {
    const frames = page.frames().filter((f) => f !== page.mainFrame());
    const sized = await Promise.all(
      frames.map(async (f) => ({
        f,
        n: await f
          .evaluate(() => document.body?.textContent?.length ?? 0)
          .catch(() => 0),
      })),
    );
    const best = sized.sort((a, b) => b.n - a.n)[0];
    if (!best || best.n === 0) return null;
    return best.f
      .evaluate((fam: string) => {
        const face = Array.from(
          (document as any).fonts as Set<FontFace>,
        ).find((x) => x.family === fam);
        // 인라인 !important 로 써야 주입된 규칙을 이긴다 (위 주석 2번).
        const measure = (family: string) => {
          const s = document.createElement("span");
          s.textContent = "가나다라마바사아자차 The quick brown fox";
          s.style.cssText =
            "position:absolute;visibility:hidden;white-space:nowrap;font-size:64px";
          s.style.setProperty("font-family", family, "important");
          document.body.append(s);
          const w = s.getBoundingClientRect().width;
          s.remove();
          return w;
        };
        return {
          faceStatus: face?.status ?? null,
          bodyFamily: getComputedStyle(document.body).fontFamily,
          wBundled: measure(`"${fam}"`),
          wBogus: measure('"NoSuchFont-XYZ-12345"'),
          wSerif: measure("serif"),
        };
      }, BUNDLED_FAMILY)
      .catch(() => null);
  };

  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);

  await expect.poll(probe, { timeout: 30_000 }).not.toBeNull();
  const v = (await probe())!;

  // (a) 번들 파일이 실제로 로드됐는가. 404·경로 오류면 status 가 error 가 된다.
  expect(
    v.faceStatus,
    `번들 글꼴이 로드되지 않았다 (status=${v.faceStatus}) — @font-face 의 절대 URL 이 섹션 blob: 문서에서 해석되지 못한 것`,
  ).toBe("loaded");

  // (b) 아무 설정도 하지 않은 기본 상태에서 본문에 적용됐는가.
  expect(v.bodyFamily, "기본 상태에서 본문이 번들 글꼴로 렌더되지 않았다").toContain(
    BUNDLED_FAMILY,
  );

  // (c) 선언만 되고 조용히 폴백된 것이 아닌가 — 대조군과 폭이 달라야 한다.
  expect(
    Math.abs(v.wBundled - v.wBogus),
    "번들 글꼴의 렌더 폭이 '존재하지 않는 글꼴'과 같다 — 선언만 되고 폴백된 것",
  ).toBeGreaterThan(1);
  expect(
    Math.abs(v.wBundled - v.wSerif),
    "번들 글꼴의 렌더 폭이 serif 와 같다 — 폴백된 것",
  ).toBeGreaterThan(1);
});

// 글꼴을 바꿨다가 기본값으로 되돌아오는 왕복. `fontFamily: null` 의 의미가
// "미설정 → 번들 기본 글꼴" 로 뒤집혔으므로, null 로 되돌리면 리디바탕이어야 한다.
test("다른 글꼴로 바꾼 뒤 기본값으로 되돌아온다", async ({ page }) => {
  const bodyFamily = async () => {
    const frames = page.frames().filter((f) => f !== page.mainFrame());
    const sized = await Promise.all(
      frames.map(async (f) => ({
        f,
        n: await f
          .evaluate(() => document.body?.textContent?.length ?? 0)
          .catch(() => 0),
      })),
    );
    const best = sized.sort((a, b) => b.n - a.n)[0];
    if (!best || best.n === 0) return null;
    return best.f
      .evaluate(() => getComputedStyle(document.body).fontFamily)
      .catch(() => null);
  };

  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);

  await expect.poll(bodyFamily, { timeout: 30_000 }).toContain(BUNDLED_FAMILY);

  // 설치된 실제 글꼴로 바꾼다.
  const fonts: { label: string; family: string | null }[] = await page.evaluate(
    () => (window as any).check.availableFonts(),
  );
  const other = fonts.find((f) => f.family)?.family;
  expect(other, "설치된 글꼴 후보를 하나도 찾지 못했다").toBeTruthy();

  await page.evaluate(
    (family) => (window as any).check.setTypography({ fontFamily: family }),
    other!,
  );
  await expect.poll(bodyFamily, { timeout: 20_000 }).toContain(other!);

  // null 로 되돌리면 번들 기본 글꼴로 돌아와야 한다.
  await page.evaluate(() =>
    (window as any).check.setTypography({ fontFamily: null }),
  );
  await expect.poll(bodyFamily, { timeout: 20_000 }).toContain(BUNDLED_FAMILY);
});

// 설치되지 않은 글꼴은 목록에서 걸러져야 한다. 걸러지지 않으면 사용자가 고른 뒤
// "아무 일도 안 일어나는" 설정을 만나게 된다.
test("설치되지 않은 글꼴은 목록에서 걸러진다", async ({ page }) => {
  await page.goto("/check.html");
  await page.waitForFunction(() => (window as any).check?.availableFonts, null, {
    timeout: 30_000,
  });

  const bogus = await page.evaluate(() =>
    (window as any).check.isFontAvailable("NoSuchFont-XYZ-12345"),
  );
  expect(bogus, "존재하지 않는 글꼴을 사용 가능으로 판정했다").toBe(false);

  const fonts: { label: string; family: string | null }[] = await page.evaluate(
    () => (window as any).check.availableFonts(),
  );
  // 첫 항목은 번들한 기본 본문 글꼴이다. `family: null` 은 "미설정 → 리디바탕" 을 뜻하며
  // "epub 자체 지정 존중" 이 아니다 — 그 선택지는 의도적으로 없앴다(ADR 260730-001332).
  expect(fonts[0].family, "첫 항목은 기본 본문 글꼴(family: null)이어야 한다").toBeNull();
  expect(fonts[0].label, "첫 항목의 이름이 리디바탕이 아니다").toBe("리디바탕");
  expect(
    fonts.some((f) => f.label === "본문 기본값 유지"),
    "없앤 '본문 기본값 유지' 항목이 목록에 남아 있다",
  ).toBe(false);
  expect(
    fonts.some((f) => f.family === "NoSuchFont-XYZ-12345"),
    "없는 글꼴이 목록에 들어갔다",
  ).toBe(false);
  // 감지기가 항상 false 를 돌려주는 것이 아님을 확인한다 (이 머신에는 한글 글꼴이 있다).
  expect(
    fonts.length,
    "설치된 한글 글꼴을 하나도 감지하지 못했다 — 감지기가 죽었을 가능성",
  ).toBeGreaterThanOrEqual(2);
});

// 이미지가 페이지(컬럼) 폭을 넘지 않는가. 실제로 발생한 회귀 —
// foliate 의 setImageSize 는 책이 지정한 max-width 를 보존하므로
// `<img style="max-width:1218px">` 같은 책에서 컬럼(743px)을 넘어 잘렸다.
// c.epub 는 CSS 가 없고 이미지가 data URI 로 박힌, 그 조건을 가진 책이다.
test("이미지가 페이지 폭을 넘지 않는다", async ({ page }) => {
  /** 로드된 모든 프레임에서 (이미지 폭, 컬럼 폭) 최악 사례를 찾는다. */
  const worstOverflow = async () => {
    let worst: { img: number; col: number; ratio: number } | null = null;
    for (const f of page.frames().filter((x) => x !== page.mainFrame())) {
      const v = await f
        .evaluate(() => {
          const col = parseFloat(
            getComputedStyle(document.documentElement).columnWidth,
          );
          if (!Number.isFinite(col) || col <= 0) return null;
          let max = 0;
          for (const el of document.querySelectorAll("img, svg, video")) {
            max = Math.max(max, el.getBoundingClientRect().width);
          }
          return max > 0 ? { img: Math.round(max), col: Math.round(col) } : null;
        })
        .catch(() => null);
      if (v) {
        const ratio = v.img / v.col;
        if (!worst || ratio > worst.ratio) worst = { ...v, ratio };
      }
    }
    return worst;
  };

  await page.goto("/check.html");

  // 픽스처가 실제로 zip 으로 서빙되는지 먼저 본다. 이게 없으면 개발 서버가
  // 설정 변경 전 인스턴스일 때 foliate 의 "File type not supported" 라는
  // 엉뚱한 메시지로 실패해 원인을 찾기 어렵다.
  const magic = await page.evaluate(async () => {
    const res = await fetch("/fixtures/c.epub");
    const head = new Uint8Array(await (await res.blob()).slice(0, 2).arrayBuffer());
    return String.fromCharCode(...head);
  });
  expect(
    magic,
    "/fixtures/c.epub 이 zip 으로 서빙되지 않았다 — 개발 서버를 재시작하라(vite.config.ts 의 픽스처 설정이 반영되지 않음)",
  ).toBe("PK");

  await page.evaluate(() => (window as any).check.openUrl("/fixtures/c.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);

  const toc: string[] = await page.evaluate(() =>
    (window as any).check.toc().map((i: any) => i.href),
  );
  // 합성 픽스처는 본문 1개 + 넓은 이미지 1개, 정확히 2항목이다.
  expect(toc.length, "c.epub 목차가 비었다").toBeGreaterThanOrEqual(2);

  // 이미지를 가진 섹션을 만날 때까지 순회하며 매번 검사한다.
  let checked = 0;
  for (const href of toc.slice(0, 25)) {
    await goTo(page, href);
    await page.waitForTimeout(500);
    const worst = await worstOverflow();
    if (!worst) continue;
    checked += 1;
    // 반올림·보더 오차를 감안해 2px 여유만 준다.
    expect(
      worst.img,
      `이미지(${worst.img}px)가 페이지 폭(${worst.col}px)을 넘었다 — ${href}`,
    ).toBeLessThanOrEqual(worst.col + 2);
  }

  expect(checked, "이미지를 가진 섹션을 하나도 만나지 못했다").toBeGreaterThan(0);
});

// 스페이스·↑·↓ 페이지 이동. ←/→ 는 공간 기준(goLeft/goRight)이지만
// 이 셋은 읽기 순서 기준(next/prev)이다 — 휠과 같은 원칙.
// 폼 컨트롤 가드도 함께 확인한다: 슬라이더에 포커스가 있으면 가로채면 안 된다
// (가드가 없으면 방금 만든 설정 패널을 키보드로 조절할 수 없게 된다).
test("스페이스·아래·위 키로 페이지를 이동하고 폼 컨트롤은 가로채지 않는다", async ({
  page,
}) => {
  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);
  await expect.poll(() => lastCfi(page), { timeout: 30_000 }).not.toBeNull();

  // 본문을 클릭해 포커스를 섹션 iframe 으로 옮긴다 — 실제 사용 상태.
  const viewport = page.viewportSize()!;
  await page.mouse.click(
    Math.round(viewport.width / 2),
    Math.round(viewport.height / 2),
  );
  await page.waitForTimeout(400);

  // 이 책은 섹션이 짧아 CFI 가 두 값 사이를 **왕복**한다. 따라서 "직전 값과 다른가"로는
  // 판정할 수 없다. relocate 이력이 늘었는지(= 키가 실제로 이동을 일으켰는지)를 보고,
  // ↑ 는 "변했다"가 아니라 **원래 자리로 돌아왔다**를 단언한다.
  const relocateCount = () =>
    page.evaluate(() => (window as any).check.locations.length);

  const pressAndSettle = async (key: string) => {
    const n = await relocateCount();
    await page.keyboard.press(key);
    await expect
      .poll(relocateCount, { timeout: 15_000 })
      .toBeGreaterThan(n);
    await page.waitForTimeout(300); // 여러 relocate 가 이어질 때 마지막까지 기다린다
    return (await lastCfi(page)) as string;
  };

  const start = (await lastCfi(page)) as string;

  const afterDown = await pressAndSettle("ArrowDown");
  expect(afterDown, "↓ 로 위치가 바뀌지 않았다").not.toBe(start);

  const afterUp = await pressAndSettle("ArrowUp");
  expect(afterUp, "↑ 로 원래 위치로 돌아오지 않았다").toBe(start);

  const afterSpace = await pressAndSettle("Space");
  expect(afterSpace, "스페이스로 위치가 바뀌지 않았다").not.toBe(start);

  // 폼 컨트롤 가드: 슬라이더에 포커스를 주고 방향키·스페이스를 눌러도
  // 페이지는 넘어가지 않고 슬라이더만 움직여야 한다.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#chrome")!.hidden = false;
  });
  await page.focus("#chrome-range");
  const rangeBefore = await page.inputValue("#chrome-range");
  const cfiBefore = await lastCfi(page);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await page.waitForTimeout(500);

  expect(
    await page.inputValue("#chrome-range"),
    "슬라이더가 방향키에 반응하지 않았다 — 리더가 키를 가로챘다",
  ).not.toBe(rangeBefore);
  expect(
    await lastCfi(page),
    "슬라이더에 포커스가 있는데 페이지가 넘어갔다",
  ).toBe(cfiBefore);
});

// 본문 좌우 1/3 클릭으로 페이지 넘김. 중앙 1/3 은 무동작이다.
//
// **좌표에 함정이 있어 프로브로 확인한 뒤 단언을 썼다. 손대기 전에 읽어라.**
// 섹션 iframe 은 페이지 하나가 아니라 **컬럼 스트립 전체 폭**으로 늘어난 뒤 컨테이너가
// 가로 스크롤된다. 그래서 iframe 안의 `e.clientX` 는 창 좌표가 아니다 — 실측: 2페이지째에서
// 창 x=128 을 클릭하면 `clientX` 가 **1264** 로 들어온다(그대로 쓰면 좌측 클릭이 우측 존으로
// 판정된다). 따라서 (a)(b) 는 **본문 iframe 위 클릭**으로 검증해야 한다. 여백(최상위 문서)
// 클릭만 보면 좌표 환산이 틀려도 통과하므로, (e) 는 그 여백 경로를 따로 덮는 대조군이다.
test("본문 좌우 1/3 클릭으로 페이지를 넘기고 중앙은 무동작이다", async ({ page }) => {
  const relocateCount = () =>
    page.evaluate(() => (window as any).check.locations.length);
  const lastFraction = (p: Page) =>
    p.evaluate(() => (window as any).check.locations.at(-1)?.fraction ?? null);

  /** 본문 프레임들 중 가장 긴 선택 텍스트. 드래그가 실제로 선택했는지 확인하는 대조군. */
  const selectionText = async () => {
    const texts = await Promise.all(
      page
        .frames()
        .filter((f) => f !== page.mainFrame())
        .map((f) =>
          f
            .evaluate(() => document.getSelection()?.toString() ?? "")
            .catch(() => ""),
        ),
    );
    return texts.sort((a, b) => b.length - a.length)[0] ?? "";
  };

  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);
  await expect.poll(() => lastCfi(page), { timeout: 30_000 }).not.toBeNull();

  // 산문 섹션으로 이동한다 — 표지 페이지에서는 클릭 지점에 본문이 없다.
  const toc: { href: string }[] = await page.evaluate(() =>
    (window as any).check.toc().map((i: any) => ({ href: i.href })),
  );
  for (const item of toc.slice(0, 10)) {
    await goTo(page, item.href);
    await page.waitForTimeout(400);
    if ((await contentText(page)).length >= 500) break;
  }
  expect(
    (await contentText(page)).length,
    "본문 500자를 가진 섹션을 찾지 못했다",
  ).toBeGreaterThanOrEqual(500);

  const vp = page.viewportSize()!;
  const y = Math.round(vp.height / 2);
  // 좌우 존 안쪽이면서 본문 iframe 위(좌우 여백 48px 밖)인 지점.
  const LEFT = Math.round(vp.width * 0.15);
  const RIGHT = Math.round(vp.width * 0.85);
  const MID = Math.round(vp.width / 2);

  const clickAndSettle = async (x: number) => {
    const n = await relocateCount();
    await page.mouse.click(x, y);
    await expect.poll(relocateCount, { timeout: 15_000 }).toBeGreaterThan(n);
    await page.waitForTimeout(300); // 연속 relocate 의 마지막까지 기다린다
    return (await lastCfi(page)) as string;
  };

  const start = (await lastCfi(page)) as string;
  const startFraction = (await lastFraction(page)) as number;

  // (a) 우측 1/3 → **앞으로**. 진행률로 단언한다 — CFI 왕복만 보면 좌우가 뒤바뀌어도
  //     대칭이라 통과한다(실제로 무력화 테스트에서 통과시켜 이 단언으로 바꿨다).
  const afterRight = await clickAndSettle(RIGHT);
  expect(afterRight, "우측 1/3 을 클릭했는데 페이지가 넘어가지 않았다").not.toBe(
    start,
  );
  expect(
    await lastFraction(page),
    "우측 1/3 을 클릭했는데 진행률이 늘지 않았다 — 뒤로 갔을 가능성",
  ).toBeGreaterThan(startFraction);

  // (b) 좌측 1/3 → **뒤로**. 원래 자리로 돌아와야 한다.
  const afterLeft = await clickAndSettle(LEFT);
  expect(afterLeft, "좌측 1/3 을 클릭했는데 원래 위치로 돌아오지 않았다").toBe(
    start,
  );
  expect(
    await lastFraction(page),
    "좌측 1/3 클릭 후 진행률이 출발점으로 돌아오지 않았다",
  ).toBeCloseTo(startFraction, 5);

  // (c) 중앙 1/3 → 무동작
  const nMid = await relocateCount();
  await page.mouse.click(MID, y);
  await page.waitForTimeout(700);
  expect(
    await relocateCount(),
    "중앙 1/3 을 클릭했는데 페이지가 넘어갔다",
  ).toBe(nMid);
  expect(await lastCfi(page), "중앙 1/3 클릭으로 위치가 변했다").toBe(start);

  // (d) 드래그로 텍스트를 선택한 뒤의 click 에서는 넘기지 않는다 (복사 경로 보호).
  //     판정은 **선택 유무가 아니라 이동 거리**다 — (i) 의 주석을 함께 읽어라.
  const nDrag = await relocateCount();
  await page.mouse.move(Math.round(vp.width * 0.55), y);
  await page.mouse.down();
  await page.mouse.move(RIGHT, y, { steps: 12 });
  await page.mouse.up();
  // 대조군: 드래그가 실제로 선택을 만들었는가. 선택이 비면 이 케이스는 공허하다.
  await expect.poll(selectionText, { timeout: 5_000 }).not.toBe("");
  await page.waitForTimeout(500);
  expect(
    await relocateCount(),
    "텍스트를 드래그 선택했는데 페이지가 넘어갔다",
  ).toBe(nDrag);

  // (e) 좌우 여백(본문 iframe 밖 = 최상위 문서)에서 온 클릭도 존 판정을 받는다.
  //     선택은 **섹션 iframe 문서**에 있다 — 최상위 document 만 지우면 (d) 의 가드가
  //     계속 막아서 이 케이스가 엉뚱하게 실패한다(실제로 한 번 밟았다).
  await page.evaluate(() => {
    const contents =
      (document.querySelector("foliate-view") as any)?.renderer?.getContents?.() ??
      [];
    for (const { doc } of contents) doc.getSelection()?.removeAllRanges();
    document.getSelection()?.removeAllRanges();
  });
  expect(await selectionText(), "(e) 준비: 선택이 지워지지 않았다").toBe("");
  const afterRight2 = await clickAndSettle(RIGHT);
  expect(afterRight2, "(e) 준비: 우측 클릭이 듣지 않았다").not.toBe(start);
  const afterMargin = await clickAndSettle(20);
  expect(
    afterMargin,
    "좌측 여백(최상위 문서)을 클릭했는데 이전 페이지로 가지 않았다",
  ).toBe(start);

  // (f) 앱 크롬(목차 패널 대역) 위 클릭은 페이지를 넘기지 않는다 — 휠과 같은 가드.
  //     크롬 폭 220px 은 좌측 1/3 안쪽이므로, 가드가 없으면 여기서 넘어간다.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#chrome")!.hidden = false;
  });
  const nChrome = await relocateCount();
  await page.mouse.click(110, 300);
  await page.waitForTimeout(700);
  expect(
    await relocateCount(),
    "앱 크롬 위를 클릭했는데 페이지가 넘어갔다",
  ).toBe(nChrome);

  // (g) **연속 클릭은 매번 넘긴다.** 빠르게 여러 번 클릭하면 두 번째 이후가 `detail` 2·3 으로
  //     들어온다 — 그걸 걸러내면 연속 넘김이 죽는다(사람 UAT 에서 실제로 보고된 결함).
  //     선택도 남지 않아야 한다: detail 2·3 은 브라우저가 단어·문단을 선택하는 값이다.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#chrome")!.hidden = true;
  });
  for (const clickCount of [1, 2, 3]) {
    const nRapid = await relocateCount();
    await page.mouse.move(RIGHT, y);
    await page.mouse.down({ clickCount });
    await page.mouse.up({ clickCount });
    await expect
      .poll(relocateCount, { timeout: 15_000 })
      .toBeGreaterThan(nRapid);
    await page.waitForTimeout(250);
    expect(
      await selectionText(),
      `detail=${clickCount} 클릭이 본문 선택을 남겼다`,
    ).toBe("");
  }

  // (h) 링크 위 클릭은 존 판정에서 제외된다 — 본문 링크 이동은 `view.js` 가 처리하므로
  //     우리가 페이지까지 넘기면 두 동작이 겹친다.
  //
  //     **책 안의 링크를 클릭하는 형태로는 단언할 수 없다**: 링크 이동(goTo)과 존 넘김이
  //     동시에 걸려 최종 위치가 비결정적이 되므로 "넘어갔는가"를 가릴 수 없다. 그래서
  //     여기서는 리더 표면 안에 앵커를 심고 그 위를 클릭해 **가드 한 줄 자체**를 본다
  //     (최상위 문서 경로지만 가드는 같은 한 줄을 지난다 — 무력화하면 이 케이스가 깨진다).
  //     실제 책의 각주 링크가 제자리로 뛰는지는 사람 UAT 항목이다.
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "#__probe_link__";
    a.id = "probe-link";
    a.textContent = "링크";
    a.style.cssText =
      "position:fixed;top:40%;right:24px;z-index:40;padding:12px;background:#fff";
    document.querySelector("#reader")!.append(a);
  });
  const nLink = await relocateCount();
  await page.click("#probe-link");
  await page.waitForTimeout(700);
  expect(
    await relocateCount(),
    "링크 위를 클릭했는데 페이지가 넘어갔다",
  ).toBe(nLink);
  await page.evaluate(() => document.querySelector("#probe-link")!.remove());

  // (i) **미세 드래그도 클릭으로 본다.** 사람 UAT 에서 나온 결함이다 — 실제 마우스는 클릭
  //     순간에도 흔들리고, 실측(Chromium)으로 **5px 만 어긋나도 한 글자가 선택된다**.
  //     "선택이 있으면 넘기지 않는다" 로 판정하던 초판은 그 흔들림에 걸려 페이지가 넘어가지
  //     않고 글자만 하이라이트된 채 남았다. 그래서 판정을 이동 거리로 바꿨고, 임계값 안의
  //     흔들림이 만든 선택은 지운다. 두 가지를 함께 단언한다: **넘어갔는가 + 선택이 없는가.**
  for (const dx of [5, 8]) {
    const nJitter = await relocateCount();
    await page.mouse.move(RIGHT, y);
    await page.mouse.down();
    await page.mouse.move(RIGHT + dx, y);
    await page.mouse.up();
    await expect
      .poll(relocateCount, { timeout: 15_000 })
      .toBeGreaterThan(nJitter);
    await page.waitForTimeout(300);
    expect(
      await selectionText(),
      `${dx}px 흔들린 클릭이 본문 선택을 남겼다`,
    ).toBe("");
  }

  // (j) 좌우 존 위에서는 커서가 방향을 드러낸다. **본문 문서와 최상위 컨테이너 양쪽**을
  //     본다 — 본문이 iframe 이라 한쪽만 걸면 나머지 절반에서 커서가 바뀌지 않는다.
  //
  //     **이미지는 PNG 여야 한다 — WebKit 은 SVG 를 커서로 렌더하지 않는다.** 처음 SVG 로
  //     넣었더니 실앱에서 이미지가 실패해 폴백 키워드로 떨어지고, macOS 가 그것을 좌우 양방향
  //     화살표(↔)로 그려 방향이 사라졌다(사람 UAT 보고). 여기서 형식을 단언하는 이유다 —
  //     Chromium 은 SVG 커서도 잘 그리므로 이 단언 없이는 회귀를 못 잡는다.
  //     (실앱 엔진에서 커서가 실제로 그려지는지는 이 하네스로 관측할 수 없다 — 사람 UAT 몫.)
  const cursors = async () => {
    const inner = await Promise.all(
      page
        .frames()
        .filter((f) => f !== page.mainFrame())
        .map((f) =>
          f
            .evaluate(() => document.documentElement.style.cursor)
            .catch(() => ""),
        ),
    );
    return {
      container: await page.evaluate(
        () => document.querySelector<HTMLElement>("#reader")!.style.cursor,
      ),
      content: inner.sort((a, b) => b.length - a.length)[0] ?? "",
    };
  };

  //     **같은 존 안에서 두 번 움직여야 한다.** foliate 의 `CursorAutohider` 가 mousemove
  //     마다 `documentElement` 의 inline cursor 를 지우므로, 한 번만 움직여 보면 "존이
  //     바뀔 때만 세팅" 하는 구현도 통과해 버린다 — 실제 앱에서 본문 위 커서가 사라진
  //     결함을 이 케이스가 놓친 이유다.
  for (const [x, keyword] of [
    [LEFT, "w-resize"],
    [RIGHT, "e-resize"],
  ] as const) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(80);
    await page.mouse.move(x + 24, y + 12); // 같은 존 안에서 한 번 더
    await page.waitForTimeout(150);
    const c = await cursors();
    for (const [where, value] of Object.entries(c)) {
      expect(value, `${keyword} 존에서 ${where} 커서가 비어 있다`).toContain(
        "data:image/png",
      );
      expect(
        value,
        `${keyword} 존 커서에 SVG 가 들어 있다 — WebKit 은 SVG 커서를 그리지 못한다`,
      ).not.toContain("svg");
      expect(
        value,
        `${keyword} 존 커서에 폴백 키워드가 없다`,
      ).toContain(keyword);
    }
  }

  // 중앙 1/3 에서는 존 커서를 걷는다 (본문 선택용 I-beam 으로 돌아가야 한다).
  await page.mouse.move(MID, y);
  await page.waitForTimeout(80);
  await page.mouse.move(MID + 24, y + 12);
  await page.waitForTimeout(150);
  const mid = await cursors();
  expect(mid.container, "중앙에서 컨테이너 커서가 남아 있다").toBe("");
  expect(mid.content, "중앙에서 본문 커서가 남아 있다").toBe("");
});

// Home/End 는 **책 전체**의 처음·끝으로, PageUp/PageDown 은 이전·다음 페이지로.
// relocate 가 진행률(fraction)을 실어 오므로 "정말 책 끝으로 갔는지"를 단언할 수 있다 —
// CFI 비교보다 훨씬 직접적인 판정이다.
test("Home·End 로 책의 처음·끝으로, PageUp·PageDown 으로 페이지를 이동한다", async ({
  page,
}) => {
  const lastFraction = () =>
    page.evaluate(
      () => (window as any).check.locations.at(-1)?.fraction ?? null,
    );
  const relocateCount = () =>
    page.evaluate(() => (window as any).check.locations.length);

  await page.goto("/check.html");
  await page.evaluate(() => (window as any).check.openUrl("/fixtures/a.epub"));
  await expect
    .poll(() => page.evaluate(() => (window as any).check.openCount), {
      timeout: 60_000,
    })
    .toBe(1);
  await expect.poll(() => lastCfi(page), { timeout: 30_000 }).not.toBeNull();

  // 본문을 클릭해 포커스를 섹션 iframe 으로 옮긴다 — 실제 사용 상태.
  const viewport = page.viewportSize()!;
  await page.mouse.click(
    Math.round(viewport.width / 2),
    Math.round(viewport.height / 2),
  );
  await page.waitForTimeout(400);

  // End → 책의 끝 (진행률이 1 에 붙는다)
  await page.keyboard.press("End");
  await expect
    .poll(lastFraction, { timeout: 20_000 })
    .toBeGreaterThan(0.98);

  // Home → 책의 처음
  await page.keyboard.press("Home");
  await expect.poll(lastFraction, { timeout: 20_000 }).toBeLessThan(0.02);

  // PageDown → 다음, PageUp → 원래 자리로 (↑↓ 와 같은 왕복 판정)
  const start = (await lastCfi(page)) as string;
  let n = await relocateCount();
  await page.keyboard.press("PageDown");
  await expect.poll(relocateCount, { timeout: 15_000 }).toBeGreaterThan(n);
  await page.waitForTimeout(300);
  expect(await lastCfi(page), "PageDown 으로 위치가 바뀌지 않았다").not.toBe(
    start,
  );

  n = await relocateCount();
  await page.keyboard.press("PageUp");
  await expect.poll(relocateCount, { timeout: 15_000 }).toBeGreaterThan(n);
  await page.waitForTimeout(300);
  expect(
    await lastCfi(page),
    "PageUp 으로 원래 위치로 돌아오지 않았다",
  ).toBe(start);
});
