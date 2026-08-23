# 《人生之书》Android SDK

Kotlin 库 + 示例 App。**刻意零外部依赖**：只用 Android 自带 API（HttpURLConnection / org.json / TextToSpeech / AudioRecord / javax.crypto），接入方不需要解决任何版本冲突。

## 目录

- `rensheng-sdk/` SDK 库模块（`implementation(project(":rensheng-sdk"))` 即可用）
  - `RenshengClient.kt` 服务端客户端（全部接口）
  - `Session.kt` 会话数据模型（schema 与 web 端一致）
  - `Conversation.kt` 陪聊会话封装（start / say / close 三步）
  - `SessionStore.kt` 本地书库（书只存本机）
  - `Tts.kt` 朗读（Android 原生 TTS）
  - `AudioRecorder.kt` 录音 → 16k PCM base64（给 /asr 用）
  - `Crypto.kt` 加密导出/导入（与 web 端格式互通）
  - `Results.kt` 引擎 / 传记 / lint 结果类型
  - `RenshengException.kt` 统一异常（code 与服务端错误码一致）
- `sample-app/` 示例 App（真机联调参考）

## 接入步骤

1. 把 `rensheng-sdk` 目录拷进你的工程（或作为独立 module 引入）。
2. 在 settings.gradle.kts 里 `include(":rensheng-sdk")`，App 模块加 `implementation(project(":rensheng-sdk"))`。
3. 电脑上起服务：`node server/server.mjs`（手机和电脑同一个 WiFi）。
4. 代码里：

```kotlin
val client = RenshengClient("http://192.168.1.5:8788")   // 电脑的局域网地址
val session = client.newSession("姥爷", "putonghua")
val conv = Conversation(client, session)
val opening = conv.start()          // 开场白 + 第一个问题
val ai = conv.say("小时候最常吃苞米面饼子")  // 引擎回话（可 AI 润色）
val bio = client.bioRender(conv.session)     // 传记（本地整理版）
val cipher = Crypto.encrypt(conv.session.toJsonString(), "家人口令")  // 加密导出
```

## 注意事项

- **所有 SDK 方法都是同步阻塞的，请在后台线程调用**（示例里用 Thread；你自己的工程用协程包一层即可）。
- 真机语音识别：服务端需要配讯飞 Key 或本地 FunASR（见 docs/06），否则用打字。
- 局域网 http 明文：示例 manifest 已开 `usesCleartextTraffic`；正式上 https 时关掉它。
- 编译 / 真机联调：用 Android Studio 打开 `sdk/android` 目录，选 sample-app 运行。
