package com.renshengzhishu.sdk

import org.json.JSONObject

/** 引擎调用结果：result 是引擎的决定，session 是改完之后的会话（已合回本地照片/录音）。 */
class EngineCallResult(val result: JSONObject, val session: Session) {
    val intent: String get() = result.optString("intent", "empty")
    val reply: String get() = result.optString("reply", "")
    val question: JSONObject? get() = result.optJSONObject("question")
    val hasQuestion: Boolean get() = question != null
    val isRefuse: Boolean get() = intent == "refuse"
    val isSilence: Boolean get() = intent == "silence"
    val isSubstantive: Boolean get() = intent == "substantive"
}

/** AI 润色结果。source: 'ai'（模型润色过）| 'engine'（直接用引擎原句）。 */
class AiTextResult(val text: String, val source: String)

/** 收尾结果：result 是纯文本（closing 接口返回字符串）。 */
class ClosingResult(val text: String, val session: Session)

/** 传记结果。source: 'ai' | 'det' | 'det-fallback'。lint 是文风检查。 */
class BioResult(
    val text: String,
    val source: String,
    val lint: LintReport
) {
    val clean: Boolean get() = lint.clean
}

/** 文风检查报告。 */
class LintReport(
    val errors: List<LintItem>,
    val warnings: List<LintItem>,
    val clean: Boolean,
    val length: Int
) {
    class LintItem(val id: String, val name: String, val count: Int, val hint: String)

    companion object {
        fun fromJson(o: JSONObject?): LintReport {
            if (o == null) return LintReport(emptyList(), emptyList(), true, 0)
            fun parse(key: String): List<LintItem> {
                val arr = o.optJSONArray(key) ?: return emptyList()
                val out = mutableListOf<LintItem>()
                for (i in 0 until arr.length()) {
                    val it = arr.optJSONObject(i) ?: continue
                    out.add(LintItem(
                        it.optString("id", ""),
                        it.optString("name", ""),
                        it.optInt("count", 0),
                        it.optString("hint", "")
                    ))
                }
                return out
            }
            return LintReport(parse("errors"), parse("warnings"), o.optBoolean("clean", true), o.optInt("length", 0))
        }
    }
}

/** 对话代理（/api/v1/chat）结果。 */
class ChatResult(val text: String, val usage: JSONObject?, val model: String?)

/** 对话记录 / 日志导出文本。 */
class TranscriptResult(val transcript: String, val log: String)
