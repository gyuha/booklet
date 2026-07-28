// LaunchServices 에 등록된 epub 핸들러를 출력한다. macos-registration.sh 가 파싱한다.
import CoreServices
import Foundation

let uti = "org.idpf.epub-container" as CFString

let def = LSCopyDefaultRoleHandlerForContentType(uti, .viewer)?
  .takeRetainedValue() as String? ?? "<none>"
print("default:\(def)")

let all =
  LSCopyAllRoleHandlersForContentType(uti, .viewer)?
  .takeRetainedValue() as? [String] ?? []
print("all:\(all.joined(separator: ","))")
