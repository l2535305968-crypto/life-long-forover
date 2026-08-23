// rensheng-sdk/build.gradle.kts — SDK 库模块（零外部依赖，只靠 Android 自带 API）
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.renshengzhishu.sdk"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
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
    // 刻意零依赖：只用 android.* / java.* / org.json（Android 自带）。
    // 不用 OkHttp / Gson / 协程，接入方不需要解决任何版本冲突。
}
