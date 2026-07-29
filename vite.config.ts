import { defineConfig, type Plugin } from "vite";
import { createReadStream, existsSync } from "node:fs";
import { homedir } from "node:os";

const host = process.env.TAURI_DEV_HOST;

/**
 * 검증용 샘플 epub 을 개발 서버에서 /fixtures/{a,b}.epub 으로 서빙한다.
 *
 * check.html 을 WKWebView 하네스(C8)로 구동할 때는 <input type=file> 을 조작할 수 없어
 * fetch 로 책을 가져와야 한다. 22MB 파일을 프로젝트로 복사하거나 server.fs.allow 를
 * 넓히는 대신 미들웨어로 스트리밍한다.
 *
 * configureServer 훅이므로 **개발 서버 전용** — 배포 빌드에는 흔적이 남지 않는다.
 */
const serveEpubFixtures = (): Plugin => {
  const samples: Record<string, string> = {
    "a.epub":
      process.env.BOOKLET_SAMPLE_EPUB ??
      `${homedir()}/Downloads/내면 근력 결국 멘탈 게임이다.epub`,
    "b.epub":
      process.env.BOOKLET_SAMPLE_EPUB2 ??
      `${homedir()}/Downloads/신 퇴마록 신세편 1.epub`,
    // 이미지 폭 회귀 재현용 **합성** 픽스처. 사용자의 파일에 의존하지 않는다
    // (처음에는 ~/Downloads 의 실제 책을 썼는데 그 파일이 사라져 체크가 깨졌다).
    // scripts/checks/make-image-fixture.sh 가 만든다.
    "c.epub": ".fixtures/image-overflow.epub",
  };
  return {
    name: "serve-epub-fixtures",
    configureServer(server) {
      server.middlewares.use("/fixtures", (req, res, next) => {
        const name = (req.url ?? "").replace(/^\//, "").split("?")[0];
        const file = samples[name];
        if (!file || !existsSync(file)) return next();
        res.setHeader("Content-Type", "application/epub+zip");
        createReadStream(file).pipe(res);
      });
    },
  };
};

/**
 * foliate-js 의 PDF 지원을 번들에서 잘라낸다. **제거하면 빌드가 깨진다 — 필수다.**
 *
 * view.js:107 에 `await import("./pdf.js")` 가 남아 있는데(upstream 소스를 안 고쳤으므로)
 * `vendor/foliate-js/pdf.js` 와 `vendor/foliate-js/vendor/pdfjs` 를 삭제했기 때문에,
 * 이 스텁이 없으면 모듈 해석이 실패한다. 자세한 사정은 vendor/foliate-js/VENDOR.md.
 *
 * 애초에 넣은 이유: pdf.js 가 `import.meta.glob("vendor/pdfjs/*")` 를 쓰는데 Vite 는
 * './' 나 '/' 로 시작하지 않는 상대 글롭을 거부해 빌드가 통째로 실패했다.
 * 지금은 파일 부재까지 함께 흡수한다. booklet 은 epub 전용이라 실행 경로가 닿지 않는다.
 */
const stubFoliatePdf = (): Plugin => {
  const STUB = "\0foliate-pdf-stub";
  return {
    name: "stub-foliate-pdf",
    // enforce: "pre" 가 없으면 Vite 코어의 vite:resolve 가 먼저 실제 pdf.js 를
    // 해석해 버려서 이 훅이 호출되지 않는다.
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./pdf.js" && importer?.includes("/vendor/foliate-js/")) {
        return STUB;
      }
      return null;
    },
    load(id) {
      if (id !== STUB) return null;
      return `export const makePDF = () => {
        throw new Error("booklet 은 PDF 를 지원하지 않습니다");
      };`;
    },
  };
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [stubFoliatePdf(), serveEpubFixtures()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
