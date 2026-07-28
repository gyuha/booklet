//! 영속 상태. `~/Library/Application Support/com.gyuha.booklet/state.json` 한 파일.
//!
//! 경로를 인자로 받는 자유 함수로 둔 것은 의도적이다 — Tauri 없이 단위 테스트할 수 있다.
//! Tauri 커맨드는 lib.rs 에서 앱 핸들로 경로만 해석해 이 함수들을 부른다.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    /// 파일을 지정하지 않고 앱을 실행했을 때 열 책.
    pub last_book: Option<String>,
    /// 파일 경로 → 읽던 위치(EPUB CFI).
    pub positions: HashMap<String, String>,
    /// 본문 글꼴 배율. 1.0 = 기본.
    pub font_scale: f64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            last_book: None,
            positions: HashMap::new(),
            font_scale: 1.0,
        }
    }
}

/// 읽기는 절대 실패하지 않는다. 파일이 없거나 JSON 이 깨졌으면 기본값을 준다 —
/// 상태 파일이 망가졌다고 뷰어가 안 뜨는 것이 더 나쁘다.
pub fn load(path: &Path) -> AppState {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, state: &AppState) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("booklet-state-test-{name}.json"))
    }

    #[test]
    fn roundtrip_preserves_state() {
        let path = tmp("roundtrip");
        let _ = std::fs::remove_file(&path);

        let mut positions = HashMap::new();
        positions.insert("/books/a.epub".to_string(), "epubcfi(/6/4!/4/2)".to_string());
        let original = AppState {
            last_book: Some("/books/a.epub".to_string()),
            positions,
            font_scale: 1.25,
        };

        save(&path, &original).expect("save 실패");
        assert_eq!(load(&path), original);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn corrupt_json_falls_back_to_default() {
        let path = tmp("corrupt");
        std::fs::write(&path, "{ this is not json ").expect("write 실패");

        assert_eq!(load(&path), AppState::default());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_file_falls_back_to_default() {
        let path = tmp("missing");
        let _ = std::fs::remove_file(&path);

        assert_eq!(load(&path), AppState::default());
    }
}
