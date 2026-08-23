// sample-app/build.gradle.kts — 示例 App（演示 SDK 接入）
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.renshengzhishu.sample"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.renshengzhishu.sample"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
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
    implementation(project(":rensheng-sdk"))
}
