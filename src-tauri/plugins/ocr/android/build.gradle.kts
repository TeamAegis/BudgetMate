plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.plugin.ocr"
    compileSdk = 36

    defaultConfig {
        minSdk = 24

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    // Google ML Kit Text Recognition - BUNDLED on-device model (Latin script). NOT the
    // Play-Services on-demand variant: the bundled model ships in the APK so there is no
    // first-use download, preserving the strict-offline guarantee (NFR-P4). Do NOT replace with
    // com.google.android.gms:play-services-mlkit-text-recognition.
    implementation("com.google.mlkit:text-recognition:16.0.1")
    // Coroutines so recognition runs off the UI thread (Dispatchers.IO) - avoids ANR (NFR-Rel2).
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    implementation(project(":tauri-android"))
}
