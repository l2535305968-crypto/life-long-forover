package com.renshengzhishu.sdk

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * 一本《人生之书》的会话数据。schema 与 web/js/core/model.js 完全一致，
 * 底层就是一个 JSONObject，保证跟服务端 /api/v1/* 往返不丢字段。
 *
 * 隐私底线：images（照片）、audio（录音）、log（日志）只留在本机；
 * [toWireJson] 发请求前会剥掉这三样，服务端永远看不到。
 */
class Session private constructor(val json: JSONObject) {

    val id: String get() = json.optString("id", "")

    // ---------- 只读访问 ----------
    fun personName(): String = json.optJSONObject("person")?.optString("name", "") ?: ""
    fun dialect(): String = json.optJSONObject("person")?.optString("dialect", "putonghua") ?: "putonghua"
    fun stage(): String = json.optJSONObject("interview")?.optString("stage", "childhood") ?: "childhood"
    fun turns(): JSONArray = json.optJSONArray("turns") ?: JSONArray()
    fun moments(): JSONArray = json.optJSONArray("moments") ?: JSONArray()
    fun profile(): JSONObject = json.optJSONObject("profile") ?: JSONObject()
    fun meta(): JSONObject = json.optJSONObject("meta") ?: JSONObject()
    fun interview(): JSONObject = json.optJSONObject("interview") ?: JSONObject()
    fun images(): JSONArray = json.optJSONArray("images") ?: JSONArray()
    fun audio(): JSONArray = json.optJSONArray("audio") ?: JSONArray()

    /** 老人 / AI 的对话轮数（turns 长度）。 */
    fun turnCount(): Int = turns().length()

    /** 最近一句老人说的话。 */
    fun lastElderText(): String? {
        val arr = turns()
        for (i in arr.length() - 1 downTo 0) {
            val t = arr.optJSONObject(i) ?: continue
            if (t.optString("role") == "elder") return t.optString("text", "")
        }
        return null
    }

    // ---------- 写操作（本地） ----------
    /** 记一轮对话（不联网，只改本地 session）。 */
    fun addTurn(role: String, text: String, audioId: String? = null) {
        val arr = json.optJSONArray("turns") ?: JSONArray().also { json.put("turns", it) }
        val turn = JSONObject()
        turn.put("role", role)
        turn.put("text", text)
        turn.put("ts", nowIso())
        if (audioId != null) turn.put("audioId", audioId)
        arr.put(turn)
        touch()
    }

    /** 加一张照片（dataUrl 字符串，存本机）。 */
    fun addImage(name: String, dataUrl: String, width: Int = 0, height: Int = 0, caption: String = "") {
        val arr = json.optJSONArray("images") ?: JSONArray().also { json.put("images", it) }
        val img = JSONObject()
        img.put("id", "img_" + System.currentTimeMillis().toString(36))
        img.put("name", name)
        img.put("dataUrl", dataUrl)
        img.put("width", width)
        img.put("height", height)
        img.put("caption", caption)
        img.put("ts", nowIso())
        arr.put(img)
        touch()
    }

    fun removeImage(id: String) {
        val arr = json.optJSONArray("images") ?: return
        val out = JSONArray()
        for (i in 0 until arr.length()) {
            val it = arr.optJSONObject(i) ?: continue
            if (it.optString("id") != id) out.put(it)
        }
        json.put("images", out)
        touch()
    }

    /** 记一条本地日志（不联网）。 */
    fun addLog(type: String, msg: String) {
        val arr = json.optJSONArray("log") ?: JSONArray().also { json.put("log", it) }
        val entry = JSONObject()
        entry.put("ts", nowIso())
        entry.put("type", type)
        entry.put("msg", msg)
        arr.put(entry)
        if (arr.length() > 500) {
            val trimmed = JSONArray()
            for (i in arr.length() - 500 until arr.length()) trimmed.put(arr.get(i))
            json.put("log", trimmed)
        }
        touch()
    }

    fun setOpeningText(text: String) {
        val meta = json.optJSONObject("meta") ?: JSONObject().also { json.put("meta", it) }
        meta.put("openingText", text)
        touch()
    }

    fun openingText(): String = meta().optString("openingText", "")

    private fun touch() {
        json.put("updatedAt", nowIso())
    }

    /** 发往服务端的版本：深拷贝并剥掉 images / audio / log。 */
    fun toWireJson(): JSONObject {
        val copy = JSONObject(json.toString())
        copy.remove("images")
        copy.remove("audio")
        copy.remove("log")
        return copy
    }

    /** 服务端返回的 wire session 合回本地：照片/录音/日志以本地为准，其余以服务端为准。 */
    fun mergeFromWire(wire: JSONObject): Session {
        val images = json.optJSONArray("images")
        val audio = json.optJSONArray("audio")
        val log = json.optJSONArray("log")
        val merged = JSONObject(wire.toString())
        if (images != null) merged.put("images", images)
        if (audio != null) merged.put("audio", audio)
        if (log != null) merged.put("log", log)
        return Session(merged)
    }

    fun toJsonString(): String = json.toString()

    companion object {
        fun fromJson(text: String): Session = Session(JSONObject(text))

        fun new(personName: String, dialect: String = "putonghua"): Session {
            val now = nowIso()
            val json = JSONObject()
            json.put("version", 1)
            json.put("id", "book_" + (System.currentTimeMillis() / 1000).toString(36))
            json.put("createdAt", now)
            json.put("updatedAt", now)

            val person = JSONObject()
            person.put("name", personName)
            person.put("birthYear", JSONObject.NULL)
            person.put("birthPlace", "")
            person.put("dialect", dialect)
            json.put("person", person)

            val interview = JSONObject()
            interview.put("stage", "childhood")
            interview.put("askedInStage", 0)
            interview.put("warmTurns", 0)
            interview.put("recentRefuse", 0)
            interview.put("askedQuestionIds", JSONArray())
            interview.put("refusedTopics", JSONArray())
            interview.put("coveredTopics", JSONArray())
            json.put("interview", interview)

            json.put("profile", JSONObject())
            json.put("moments", JSONArray())
            json.put("turns", JSONArray())
            json.put("repeats", JSONArray())
            json.put("audio", JSONArray())
            json.put("images", JSONArray())
            json.put("log", JSONArray())

            val auth = JSONObject()
            auth.put("grantCode", randomGrantCode())
            auth.put("familyEnabled", false)
            auth.put("grantedAt", JSONObject.NULL)
            json.put("auth", auth)

            val meta = JSONObject()
            meta.put("engineVersion", "1.0")
            meta.put("lastStage", "childhood")
            json.put("meta", meta)

            return Session(json)
        }

        private fun randomGrantCode(): String {
            val chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
            val sb = StringBuilder()
            repeat(8) { sb.append(chars.random()) }
            return sb.toString()
        }
    }
}

internal fun nowIso(): String {
    val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    f.timeZone = TimeZone.getTimeZone("UTC")
    return f.format(Date())
}
