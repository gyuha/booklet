//! 영속 상태. `~/Library/Application Support/com.gyuha.booklet/state.json` 한 파일.
//!
//! 경로를 인자로 받는 자유 함수로 둔 것은 의도적이다 — Tauri 없이 단위 테스트할 수 있다.
//! Tauri 커맨드는 lib.rs 에서 앱 핸들로 경로만 해석해 이 함수들을 부른다.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// 타이포그래피 값은 **전역**이다 — 책의 속성이 아니라 읽는 사람의 속성이므로
/// positions 처럼 책별로 갖지 않는다 (CONTEXT.md 의 "타이포그래피 설정" 참조).
///
/// 중첩 객체로 묶지 않고 평평하게 둔 것은 의도적이다: serde 의 `default` 가 빈 필드를
/// 채우므로 이 필드들이 없는 옛 state.json 도 마이그레이션 없이 그대로 읽힌다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    /// 파일을 지정하지 않고 앱을 실행했을 때 열 책.
    pub last_book: Option<String>,
    /// 파일 경로 → 읽던 위치(EPUB CFI).
    pub positions: HashMap<String, String>,
    /// 본문 글꼴 배율. 1.0 = 기본.
    pub font_scale: f64,
    /// 본문 글꼴 이름. None = epub 자체 지정을 존중(아무것도 주입하지 않음).
    pub font_family: Option<String>,
    /// 줄간격. 1.7 = 이 값이 설정으로 승격되기 전까지 하드코딩되어 있던 값.
    pub line_height: f64,
    /// 자간(em). 0 = 기본. 한글은 음수 쪽이 위험해 UI 에서 좁게 제한한다.
    pub letter_spacing: f64,
    /// 본문 양쪽 여백(px). 48 = foliate paginator 기본값.
    pub margin: f64,
    /// 본문을 굵게. 단계가 아니라 on/off 인 이유는 `src/reader.ts` 의 `Typography.bold` 참조
    /// (번들 글꼴이 단일 웨이트라 굵기가 엔진 합성 볼드에서 나오고, 실측상 두 단계뿐이다).
    pub bold: bool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            last_book: None,
            positions: HashMap::new(),
            font_scale: 1.0,
            font_family: None,
            line_height: 1.7,
            letter_spacing: 0.0,
            margin: 48.0,
            bold: false,
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
            font_family: Some("Pretendard".to_string()),
            line_height: 2.05,
            letter_spacing: 0.03,
            margin: 96.0,
            bold: true,
        };

        save(&path, &original).expect("save 실패");
        assert_eq!(load(&path), original);

        let _ = std::fs::remove_file(&path);
    }

    /// 타이포그래피 필드가 없는 옛 state.json 이 마이그레이션 없이 읽히는가.
    /// 평평한 구조 + serde default 를 택한 이유가 바로 이것이다.
    #[test]
    fn state_without_typography_fields_gets_defaults() {
        let path = tmp("legacy");
        std::fs::write(
            &path,
            r#"{"lastBook":"/books/old.epub","positions":{},"fontScale":1.4}"#,
        )
        .expect("write 실패");

        let loaded = load(&path);
        assert_eq!(loaded.last_book.as_deref(), Some("/books/old.epub"));
        assert_eq!(loaded.font_scale, 1.4, "기존 값은 보존되어야 한다");
        assert_eq!(loaded.font_family, None);
        assert_eq!(loaded.line_height, 1.7, "빠진 필드는 기본값");
        assert_eq!(loaded.letter_spacing, 0.0);
        assert_eq!(loaded.margin, 48.0);

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
