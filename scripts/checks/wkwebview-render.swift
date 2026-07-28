// C8 — 실제 앱과 같은 엔진(WKWebView)에서 렌더링을 검증한다.
//
// C3 는 Playwright/Chromium 에서 돈다. booklet 은 WKWebView 이므로 C3 통과가
// 실앱 동작을 보장하지 않는다 — 그 간극이 이 체크의 존재 이유다.
//
// GUI 권한이 전혀 필요 없다: 창을 띄우지 않고(activationPolicy .prohibited)
// 오프스크린 WKWebView 를 만들어 callAsyncJavaScript 로 구동한다.
// 로직은 전부 wkwebview-driver.js 에 있다.
//
// 사용법: swift scripts/checks/wkwebview-render.swift [http://localhost:1420/check.html]
//         (vite 개발 서버가 떠 있어야 한다 — Taskfile 의 check:c8 이 처리한다)

import AppKit
import WebKit

let pageURL =
  CommandLine.arguments.count > 1
  ? CommandLine.arguments[1] : "http://localhost:1420/check.html"

// 드라이버는 이 스크립트와 같은 디렉터리에 있다.
let driverURL = URL(fileURLWithPath: CommandLine.arguments[0])
  .deletingLastPathComponent()
  .appendingPathComponent("wkwebview-driver.js")

guard let driver = try? String(contentsOf: driverURL, encoding: .utf8) else {
  print("FAIL(C8): 드라이버를 읽지 못했다: \(driverURL.path)")
  exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

final class Harness: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  let web: WKWebView
  let driver: String

  // WKWebView 는 콘솔을 전달하지 않는다. 모듈 로드 실패를 진단하려면 직접 붙여야 한다.
  private static let bridge = """
    (() => {
      const send = (kind, text) => {
        try { window.webkit.messageHandlers.log.postMessage(kind + ": " + text) } catch {}
      };
      window.addEventListener("error", (e) =>
        send("error", (e.message || "?") + " @ " + (e.filename || "?") + ":" + (e.lineno || 0)));
      window.addEventListener("unhandledrejection", (e) =>
        send("reject", String(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
      for (const m of ["error", "warn"]) {
        const orig = console[m].bind(console);
        console[m] = (...a) => { send("console." + m, a.map(String).join(" ")); orig(...a) };
      }
    })()
    """

  init(driver: String) {
    self.driver = driver
    let cfg = WKWebViewConfiguration()
    cfg.userContentController.addUserScript(
      WKUserScript(source: Harness.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    web = WKWebView(
      frame: NSRect(x: 0, y: 0, width: 800, height: 1000), configuration: cfg)
    super.init()
    cfg.userContentController.add(self, name: "log")
    web.navigationDelegate = self
  }

  func userContentController(
    _ c: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    print("  [page] \(message.body)")
  }

  func load(_ url: String) {
    guard let u = URL(string: url) else {
      print("FAIL(C8): 잘못된 URL: \(url)")
      exit(2)
    }
    web.load(URLRequest(url: u))
  }

  func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
    w.callAsyncJavaScript(driver, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .success(let value):
        let json = value as? String ?? "\(value)"
        print("OK(C8): WKWebView 렌더링 검증 통과")
        print("  \(json)")
        exit(0)
      case .failure(let error):
        // localizedDescription 은 "A JavaScript exception occurred" 로만 나오므로
        // 실제 메시지·위치를 userInfo 에서 꺼낸다.
        let info = (error as NSError).userInfo
        let msg = info["WKJavaScriptExceptionMessage"] as? String
        print("FAIL(C8): \(msg ?? error.localizedDescription)")
        if let line = info["WKJavaScriptExceptionLineNumber"] {
          print("  위치: line \(line) col \(info["WKJavaScriptExceptionColumnNumber"] ?? "?")")
        }
        exit(1)
      }
    }
  }

  func webView(_ w: WKWebView, didFail nav: WKNavigation!, withError error: Error) {
    print("FAIL(C8): 페이지 로드 실패 — \(error.localizedDescription)")
    exit(1)
  }

  func webView(
    _ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error
  ) {
    print("FAIL(C8): 서버에 연결하지 못했다 (vite 개발 서버가 떠 있는가?) — \(error.localizedDescription)")
    exit(1)
  }
}

let harness = Harness(driver: driver)
harness.load(pageURL)

DispatchQueue.main.asyncAfter(deadline: .now() + 180) {
  print("FAIL(C8): 180초 타임아웃")
  exit(1)
}
app.run()
