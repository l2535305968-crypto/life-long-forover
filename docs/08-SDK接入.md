# 08 · SDK 接入文档

把《人生之书》整套系统做成 SDK：**服务端计算，客户端接入**。
手机 App（Android）、脚本、别的网页都能把访谈引擎、AI 对话、传记、时间线、语音识别当服务用。

## 一、架构

```
┌─────────────────┐   HTTP (REST)   ┌────────────────────────────────────┐
│  Android App     │ ─────────────▶ │  server/app.mjs   （电脑 / 云托管）  │
│  JS 客户端        │ ◀───────────── │  /api/v1/*                          │
│  Web PWA（原有）   │               │  引擎 / AI / 传记 / 时间线 / 记录     │
└─────────────────┘               │  /api/chat /api/asr（原有，兼容）     │
                                  └────────────────────────────────────┘
```

- 原有 web 前端**完全不动**，照常工作；新增的 `/api/v1/*` 是给 SDK 客户端用的。
- 服务端**无状态**：每次请求把会话（session）发过来，算完返回，不落盘、不打印正文。
- DeepSeek Key 只在服务端；照片 / 录音 / 日志在客户端发请求前被剥掉，服务端永远看不到。

## 二、快速开始

```bash
# 1. 起服务（.env 里配好 DEEPSEEK_API_KEY）
node server/server.mjs

# 2. 验证
curl http://localhost:8788/api/v1/health
```

### JS SDK（浏览器 / Node 通用，零依赖）

```js
import { SdkClient, Conversation } from './sdk/js/index.mjs';

const client = new SdkClient('http://192.168.1.5:8788');  // 电脑局域网地址
let session = await client.newSession({ personName: '姥爷', dialect: 'putonghua' });

const conv = new Conversation(client, session);
await conv.start();                                   // 开场白 + 第一个问题
const ai = await conv.say('小时候最常吃苞米面饼子');   // 引擎回话（自动 AI 润色）
session = conv.session;                               // 本地会话已更新

const bio = await client.bioRender(session);          // 传记（本地整理版）
const tl  = await client.timeline(session);           // 人生时间线
```

### Android SDK（Kotlin，零依赖）

```kotlin
val client = RenshengClient("http://192.168.1.5:8788")
val session = client.newSession("姥爷", "putonghua")
val conv = Conversation(client, session)
val opening = conv.start()
val ai = conv.say("小时候最常吃苞米面饼子")
```

Android 工程在 `sdk/android/`，用 Android Studio 打开即可编译示例 App。

## 三、接口清单（/api/v1/*）

统一返回 `{ ok: true, ... }` 或 `{ ok: false, code, error }`。

| 方法 | 路径 | 请求体 | 返回 |
|------|------|--------|------|
| GET | /api/v1/health | — | `{ apiVersion, hasKey, hasAsr, model, time }` |
| GET | /api/v1/dialects | — | `{ packs: [{id,name,area,speechLang}] }` |
| POST | /api/v1/session/new | `{ personName?, dialect? }` | `{ session }` |
| POST | /api/v1/engine/opening | `{ session }` | `{ result, session }` |
| POST | /api/v1/engine/closing | `{ session }` | `{ result, session }` |
| POST | /api/v1/engine/respond | `{ session, text, audioId? }` | `{ result, session }` |
| POST | /api/v1/engine/summarize | `{ session }` | `{ summary, session }` |
| POST | /api/v1/ai/polish | `{ session, questionText, extraSystem? }` | `{ text, source }` |
| POST | /api/v1/ai/next | `{ session, engineResult, aiEnabled?, extraSystem? }` | `{ text, source }` |
| POST | /api/v1/bio/render | `{ session }` | `{ text, lint, deterministic }` |
| POST | /api/v1/bio/generate | `{ session }` | `{ text, source, lint }` |
| POST | /api/v1/bio/lint | `{ text }` | `{ report }` |
| POST | /api/v1/timeline | `{ session }` | `{ timeline }` |
| POST | /api/v1/transcript | `{ session }` | `{ transcript, log }` |
| POST | /api/v1/chat | `{ messages, temperature?, max_tokens? }` | `{ text, usage, model }` |
| POST | /api/v1/asr | `{ audio, dialect?, accent? }` | `{ text }` |

### respond 的结果（result）

```json
{
  "intent": "substantive | refuse | silence | empty",
  "reply": "引擎这句该怎么回",
  "question": { "id": "...", "text": "...", "stage": "...", "topic": "...", "sensitivity": 0 },
  "repeat": true,       // 老人在重复讲同一件事（不点破）
  "extension": true,    // 顺着上句话延伸追问
  "closing": true       // 聊到没得挑了，收尾
}
```

### session 结构（与 web/js/core/model.js 一致）

发请求时**必须**用 SDK 的剥壳版本（自动去掉 images / audio / log）：

```json
{
  "version": 1, "id": "book_xxx", "createdAt": "...", "updatedAt": "...",
  "person": { "name": "姥爷", "birthYear": null, "birthPlace": "", "dialect": "putonghua" },
  "interview": { "stage": "childhood", "askedInStage": 0, "warmTurns": 0,
                 "recentRefuse": 0, "askedQuestionIds": [], "refusedTopics": [], "coveredTopics": [] },
  "profile": {}, "moments": [], "turns": [], "repeats": [],
  "auth": { "grantCode": "XXXX", "familyEnabled": false }
}
```

> 照片（images）/ 录音（audio）/ 日志（log）是本地专属字段，永远不发给服务端；
> 服务端返回的 session 也不含这三样，客户端 SDK 会自动合回本地（mergeSession）。

## 四、错误码

| code | HTTP | 含义 |
|------|------|------|
| RATE | 429 | 一分钟里问得太多，歇一下 |
| NO_KEY | 503 | 服务端没配 DeepSeek Key（AI 接口） |
| NO_ASR_KEY | 503 | 讯飞 / 本地 FunASR 都没配（ASR 接口） |
| BAD_SESSION | 400 | session 不是对象 / interview 缺失 |
| BAD_TEXT | 400 | text / questionText 不是字符串或为空 |
| BAD_JSON | 400 | 请求体不是合法 JSON |
| BAD_MESSAGES | 400 | /chat 的 messages 不合法 |
| BAD_AUDIO | 400 | /asr 缺 audio 字段 |
| TOO_LARGE | 413 | 请求体超限 |
| EMPTY | 400 | 请求体为空 |
| METHOD | 405 | 方法不对 |
| NOT_FOUND | 404 | 没有这个 v1 接口 |
| UPSTREAM / TIMEOUT / NETWORK | 502/504 | 上游 DeepSeek 或 ASR 出问题 |
| INTERNAL | 500 | 服务端内部错误 |

## 五、隐私（SDK 层面写死）

1. **照片 / 录音 / 日志不上传**：`stripForWire` / `Session.toWireJson` 在发出前剥掉。
2. **服务端不落盘**：每次请求独立计算，无状态，不写任何存储。
3. **不打印正文**：服务端日志只有时间、路径、状态码。
4. **Key 不下发**：DeepSeek Key 只存在服务端 `.env`。
5. **加密在客户端**：`sdk/js/crypto.mjs`（浏览器/Node）与 `Crypto.kt`（Android）格式互通，
   AES-256-GCM + PBKDF2(210000 次)，没口令谁也打不开。

## 六、SDK 目录

```
sdk/
  README.md
  js/                 JS SDK（零依赖 ESM）
    index.mjs         入口
    client.mjs        SdkClient / SdkError
    session.mjs       newSession / stripForWire / mergeSession / Conversation
    crypto.mjs        encryptText / decryptText / exportBook / importBook
    package.json
  android/            Android(Kotlin) SDK + 示例 App
    rensheng-sdk/     SDK 库（零依赖）
    sample-app/       示例 App（MainActivity 演示完整接入）
```

## 七、跟原有 web 前端的关系

- `/api/chat`、`/api/asr`、`/api/health` 原样保留，web 前端不受影响。
- 新功能只加在 `/api/v1/*`，互不干扰。
- 测试：`node test/sdk-api.test.mjs`（接口）+`node test/sdk-js.test.mjs`（JS SDK 端到端），
  已纳入 `node test/run-all.mjs`。
