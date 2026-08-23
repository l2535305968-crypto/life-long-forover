# 《人生之书》SDK

把整套系统做成 SDK：**服务端计算，客户端接入**。

- `js/` — JS SDK（零依赖 ESM，浏览器 + Node 通用）
- `android/` — Android(Kotlin) SDK + 示例 App（Gradle 工程源码）
- 接口契约与错误码：见 docs/08-SDK接入.md

## 隐私底线（SDK 里写死的，不是口号）

- 发请求前自动剥掉 **照片 / 录音 / 日志**（`stripForWire` / `Session.toWireJson`），服务端永远看不到。
- 服务端不落盘、不打印正文，日志只有时间、路径、状态码。
- DeepSeek Key 只在服务端，客户端拿不到。
- 加密导出（AES-256-GCM + PBKDF2）在客户端做，两端格式互通。
