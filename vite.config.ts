import { defineConfig, type Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;

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
  plugins: [stubFoliatePdf()],

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
