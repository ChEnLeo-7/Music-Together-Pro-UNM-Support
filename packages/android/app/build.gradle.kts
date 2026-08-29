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
    versionCode = 4
    versionName = "0.4.0"
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }
}

dependencies {
  implementation("androidx.activity:activity-ktx:1.10.0")
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.media3:media3-exoplayer:1.5.1")
  implementation("androidx.media3:media3-session:1.5.1")
  implementation("io.socket:socket.io-client:2.1.1")
}
