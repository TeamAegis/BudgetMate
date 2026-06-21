// On-device OCR plugin (Android). Google ML Kit Text Recognition, bundled model.
//
// Contract (architecture.md §6.2):
//   invoke("plugin:ocr|recognize_text", { imagePath }) -> { blocks: [{ text, bbox, confidence }] }
//
// Returns RAW recognised text + boxes only - it makes NO financial decision. Deterministic field
// extraction (merchant/date/total) lives in the Rust core (app_lib::rules::receipt) and the user
// confirms before saving (FR-2.1). Recognition runs on Dispatchers.IO so the UI thread is never
// blocked (NFR-Rel2). Fully offline: the bundled ML Kit model needs no network.

package com.plugin.ocr

import android.app.Activity
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

@InvokeArg
class RecognizeTextArgs {
    lateinit var imagePath: String
}

@TauriPlugin
class OcrPlugin(private val activity: Activity) : Plugin(activity) {
    // Latin-script, on-device, bundled recognizer.
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    @Command
    fun recognize_text(invoke: Invoke) {
        val args = invoke.parseArgs(RecognizeTextArgs::class.java)

        // Accept either a filesystem path (e.g. /sdcard/DCIM/…) or a URI returned by the OS picker
        // (content://… / file://…). ML Kit's InputImage.fromFilePath resolves content URIs via the
        // ContentResolver, so both work.
        val path = args.imagePath
        val uri = if (path.startsWith("content://") || path.startsWith("file://")) {
            Uri.parse(path)
        } else {
            val file = File(path)
            if (!file.exists()) {
                invoke.reject("image not found: $path")
                return
            }
            Uri.fromFile(file)
        }

        // Decode the image off the UI thread; recognition itself runs on an ML Kit worker thread
        // and its callbacks return on the main thread (safe to resolve from there).
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val image = InputImage.fromFilePath(activity, uri)
                recognizer.process(image)
                    .addOnSuccessListener { visionText ->
                        invoke.resolve(mapResult(visionText))
                    }
                    .addOnFailureListener { e ->
                        invoke.reject(e.message ?: "OCR recognition failed")
                    }
            } catch (e: Exception) {
                invoke.reject(e.message ?: "failed to read image")
            }
        }
    }

    // Map ML Kit blocks to the contract shape { blocks: [{ text, bbox{x,y,w,h}, confidence }] }.
    // ML Kit does not expose a per-block confidence, so we emit a sentinel of 1.0 - the Rust
    // extractor decides from text + position, not confidence.
    private fun mapResult(visionText: com.google.mlkit.vision.text.Text): JSObject {
        val blocks = JSArray()
        for (block in visionText.textBlocks) {
            val rect = block.boundingBox
            val bbox = JSObject()
            bbox.put("x", (rect?.left ?: 0).toDouble())
            bbox.put("y", (rect?.top ?: 0).toDouble())
            bbox.put("w", ((rect?.width()) ?: 0).toDouble())
            bbox.put("h", ((rect?.height()) ?: 0).toDouble())

            val entry = JSObject()
            entry.put("text", block.text)
            entry.put("bbox", bbox)
            entry.put("confidence", 1.0)
            blocks.put(entry)
        }
        val result = JSObject()
        result.put("blocks", blocks)
        return result
    }
}
