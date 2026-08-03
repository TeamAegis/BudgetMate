# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# Custom OCR Tauri plugin (src-tauri/plugins/ocr)
#
# The Rust core loads this class BY NAME - register_android_plugin("com.plugin.ocr", "OcrPlugin")
# in src-tauri/plugins/ocr/src/mobile.rs - and tauri-android then discovers the @Command methods
# and @InvokeArg argument classes reflectively. R8 has no static reference to follow, so a rename
# or strip surfaces only at runtime in a release build, as
# `ClassNotFoundException: com.plugin.ocr.OcrPlugin` during startup.
#
# tauri-android's consumer rules already keep `@TauriPlugin public class *`, so these are
# belt-and-braces: they survive a consumer-rule regression and document the reflective contract.
-keep class com.plugin.ocr.OcrPlugin {
    public <init>(...);
    @app.tauri.annotation.Command public <methods>;
}
-keep class com.plugin.ocr.RecognizeTextArgs { *; }
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault