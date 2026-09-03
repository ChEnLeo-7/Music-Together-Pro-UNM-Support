plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "app.musictogether.android"
  compileSdk = 35

  defaultConfig {
    applicationId = "app.musictogether.android"
    minSdk = 26
    targetSdk = 35
    versionCode = 14
    versionName = "0.10.2"
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }

  signingConfigs {
    create("release") {
      storeFile = System.getenv("ANDROID_KEYSTORE_PATH")?.let(::file)
      storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
      keyAlias = System.getenv("ANDROID_KEY_ALIAS")
      keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
    }
  }

  buildTypes {
    getByName("release") {
      signingConfig = signingConfigs.getByName("release")
      isMinifyEnabled = false
    }
  }
}

dependencies {
  implementation("androidx.activity:activity-ktx:1.10.0")
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.media3:media3-exoplayer:1.5.1")
  implementation("androidx.media3:media3-session:1.5.1")
  implementation("com.google.android.material:material:1.12.0")
  implementation("io.socket:socket.io-client:2.1.1")
  testImplementation("junit:junit:4.13.2")
}
