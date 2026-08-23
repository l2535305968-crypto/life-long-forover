package com.renshengzhishu.sdk

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * 《人生之书》服务端 SDK 客户端。
 *
 * 用法（全部是同步阻塞方法，请在后台线程调用，不要在主线程跑）：
 *
 *   val client = RenshengClient("http://192.168.1.5:8788")
 *   val session = client.newSession("姥爷", "putonghua")
 *   val opened = client.opening(session)          // 开场白 + 第一个问题
 *   val r = client.respond(session, "小时候最常吃苞米面饼子")  // 引擎回话
 *   val ai = client.aiNext(session, r.result)     // （可选）AI 润色
 *
 * 隐私：所有请求发出前都会剥掉照片 / 录音 / 日志（见 Session.toWireJson）。
 * 服务端不落盘、不打印正文；本 SDK 也不在本地记录任何请求内容。
 */
class RenshengClient(
    private val baseUrl: String,
    private val connectTimeoutMs: Int = 10_000,
    private val readTimeoutMs: Int = 120_000
) {

    private val base: String = baseUrl.trimEnd('/')

    // ---------- 网络 ----------
    private fun open(path: String, method: String): HttpURLConnection {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = connectTimeoutMs
        conn.readTimeout = readTimeoutMs
        conn.setRequestProperty("Accept", "application/json")
        return conn
    }

    private fun send(conn: HttpURLConnection, body: JSONObject?): JSONObject {
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
        }
        return read(conn)
    }

    private fun read(conn: HttpURLConnection): JSONObject {
        val status = try {
            conn.responseCode
        } catch (e: IOException) {
            throw RenshengException("连不上服务：${e.message}", RenshengException.CODE_NETWORK, 0)
        }
        val stream = if (status in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.let { s ->
            ByteArrayOutputStream().use { buf ->
                s.copyTo(buf)
                String(buf.toByteArray(), Charsets.UTF_8)
            }
        } ?: ""
        conn.disconnect()

        val json = try {
            JSONObject(text)
        } catch (e: Exception) {
            throw RenshengException("服务返回的不是 JSON（HTTP ${status}）", RenshengException.CODE_UNKNOWN, status)
        }
        if (!json.optBoolean("ok", false)) {
            throw RenshengException(
                json.optString("error", "请求失败（HTTP ${status}）"),
                json.optString("code", RenshengException.CODE_UNKNOWN),
                status
            )
        }
        return json
    }

    private fun post(path: String, body: JSONObject? = null): JSONObject = send(open(path, "POST"), body)
    private fun get(path: String): JSONObject = send(open(path, "GET"), null)

    // ---------- 基础 ----------
    fun health(): JSONObject = get("/api/v1/health")

    fun dialects(): List<DialectMeta> {
        val data = get("/api/v1/dialects")
        val arr = data.optJSONArray("packs") ?: JSONArray()
        val out = mutableListOf<DialectMeta>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out.add(DialectMeta(
                o.optString("id", ""),
                o.optString("name", ""),
                o.optString("area", ""),
                o.optString("speechLang", "zh-CN")
            ))
        }
        return out
    }

    // ---------- 会话 ----------
    fun newSession(personName: String = "", dialect: String = "putonghua"): Session {
        val body = JSONObject()
        body.put("personName", personName)
        body.put("dialect", dialect)
        val data = post("/api/v1/session/new", body)
        return Session.fromJson(data.getJSONObject("session").toString())
    }

    // ---------- 引擎 ----------
    fun opening(session: Session): EngineCallResult {
        val body = JSONObject().put("session", session.toWireJson())
        val data = post("/api/v1/engine/opening", body)
        return EngineCallResult(data.getJSONObject("result"), session.mergeFromWire(data.getJSONObject("session")))
    }

    fun closing(session: Session): ClosingResult {
        val body = JSONObject().put("session", session.toWireJson())
        val data = post("/api/v1/engine/closing", body)
        val text = data.optString("result", "今天先聊到这儿，改天接着聊。")
        return ClosingResult(text, session.mergeFromWire(data.getJSONObject("session")))
    }

    fun respond(session: Session, text: String, audioId: String? = null): EngineCallResult {
        val body = JSONObject()
        body.put("session", session.toWireJson())
        body.put("text", text)
        if (audioId != null) body.put("audioId", audioId)
        val data = post("/api/v1/engine/respond", body)
        return EngineCallResult(data.getJSONObject("result"), session.mergeFromWire(data.getJSONObject("session")))
    }

    fun summarize(session: Session): JSONObject {
        val body = JSONObject().put("session", session.toWireJson())
        return post("/api/v1/engine/summarize", body).getJSONObject("summary")
    }

    // ---------- AI 润色 ----------
    fun aiPolish(session: Session, questionText: String, extraSystem: String? = null): AiTextResult {
        val body = JSONObject()
        body.put("session", session.toWireJson())
        body.put("questionText", questionText)
        if (extraSystem != null) body.put("extraSystem", extraSystem)
        val data = post("/api/v1/ai/polish", body)
        return AiTextResult(data.optString("text", ""), data.optString("source", "engine"))
    }

    fun aiNext(session: Session, engineResult: JSONObject, aiEnabled: Boolean = true): AiTextResult {
        val body = JSONObject()
        body.put("session", session.toWireJson())
        body.put("engineResult", engineResult)
        body.put("aiEnabled", aiEnabled)
        val data = post("/api/v1/ai/next", body)
        return AiTextResult(data.optString("text", ""), data.optString("source", "engine"))
    }

    // ---------- 传记 / 时间线 / 记录 ----------
    fun bioRender(session: Session): BioResult {
        val body = JSONObject().put("session", session.toWireJson())
        val data = post("/api/v1/bio/render", body)
        return BioResult(
            data.optString("text", ""),
            if (data.optBoolean("deterministic", false)) "det" else "unknown",
            LintReport.fromJson(data.optJSONObject("lint"))
        )
    }

    fun bioGenerate(session: Session): BioResult {
        val body = JSONObject().put("session", session.toWireJson())
        val data = post("/api/v1/bio/generate", body)
        return BioResult(
            data.optString("text", ""),
            data.optString("source", "det"),
            LintReport.fromJson(data.optJSONObject("lint"))
        )
    }

    fun bioLint(text: String): LintReport {
        val body = JSONObject().put("text", text)
        return LintReport.fromJson(post("/api/v1/bio/lint", body).optJSONObject("report"))
    }

    fun timeline(session: Session): JSONObject {
        val body = JSONObject().put("session", session.toWireJson())
        return post("/api/v1/timeline", body).getJSONObject("timeline")
    }

    fun transcript(session: Session): TranscriptResult {
        val body = JSONObject().put("session", session.toWireJson())
        val data = post("/api/v1/transcript", body)
        return TranscriptResult(data.optString("transcript", ""), data.optString("log", ""))
    }

    // ---------- 对话代理 / 语音识别 ----------
    fun chat(messages: List<ChatMessage>, temperature: Double? = null, maxTokens: Int? = null): ChatResult {
        val arr = JSONArray()
        for (m in messages) {
            arr.put(JSONObject().put("role", m.role).put("content", m.content))
        }
        val body = JSONObject().put("messages", arr)
        if (temperature != null) body.put("temperature", temperature)
        if (maxTokens != null) body.put("max_tokens", maxTokens)
        val data = post("/api/v1/chat", body)
        return ChatResult(data.optString("text", ""), data.optJSONObject("usage"), data.optString("model", ""))
    }

    /** 把一段 16k/16bit 单声道 PCM 的 base64 转成文字。 */
    fun asr(pcmBase64: String, dialect: String? = null): String {
        val body = JSONObject().put("audio", pcmBase64)
        if (dialect != null) body.put("dialect", dialect)
        return post("/api/v1/asr", body).optString("text", "")
    }

    /** 聊天消息（/api/v1/chat 用）。 */
    class ChatMessage(val role: String, val content: String) {
        companion object {
            fun system(text: String) = ChatMessage("system", text)
            fun user(text: String) = ChatMessage("user", text)
            fun assistant(text: String) = ChatMessage("assistant", text)
        }
    }

    /** 方言包元信息。 */
    class DialectMeta(val id: String, val name: String, val area: String, val speechLang: String)
}
