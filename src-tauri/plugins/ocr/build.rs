// Generates the plugin's permission files from the command list. The app capability grants
// `ocr:allow-recognize-text` (or `ocr:default`) to expose this to the frontend.
const COMMANDS: &[&str] = &["recognize_text"];

fn main() {
    // `android_path` registers the plugin's Android Gradle project so the Tauri CLI includes it
    // in the app's `gen/android` build (without it the Kotlin OcrPlugin class is never packaged →
    // ClassNotFoundException at startup). No `ios_path`: iOS (Apple Vision) is deferred.
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
