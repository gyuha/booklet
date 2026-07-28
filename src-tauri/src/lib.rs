use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// macOS "다음으로 열기"로 앱이 처음 실행될 때, 프론트엔드가 준비되기 전에
/// 파일 경로가 도착한다. 프론트가 가져갈 때까지 여기 담아 둔다.
#[derive(Default)]
struct PendingOpen(Mutex<Option<String>>);

/// epub 파일을 그대로 바이트로 넘긴다. JSON 배열이 아니라 raw 응답이라
/// 수십 MB짜리 책도 직렬화 비용 없이 전달된다.
#[tauri::command]
fn read_book(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn take_pending_book(state: tauri::State<'_, PendingOpen>) -> Option<String> {
    state.0.lock().ok()?.take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpen::default())
        .invoke_handler(tauri::generate_handler![read_book, take_pending_book])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            if let Some(path) = urls.iter().find_map(|u| u.to_file_path().ok()) {
                let path = path.to_string_lossy().into_owned();
                if let Ok(mut pending) = _handle.state::<PendingOpen>().0.lock() {
                    *pending = Some(path.clone());
                }
                let _ = _handle.emit("book-opened", path);
            }
        }
    });
}
