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

  await page.evaluate(() => (window as any).check.reader.setFontScale(1.6));
  await expect
    .poll(htmlFontSize, { timeout: 30_000 })
    .toBeGreaterThan(base * 1.3);

  await page.evaluate(() => (window as any).check.reader.setFontScale(1));
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
