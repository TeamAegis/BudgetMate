// Generates the plugin's permission files from the command list. The app capability grants
// `ocr:allow-recognize-text` (or `ocr:default`) to expose this to the frontend.
const COMMANDS: &[&str] = &["recognize_text"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
