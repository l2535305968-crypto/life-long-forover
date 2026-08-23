package com.renshengzhishu.sdk

/**
 * 陪聊会话：把 加话 → 引擎回话 → （可选）AI 润色 → 记下 AI 的话 串成一步。
 * 与 web 前端 commitElder 语义一致：拒绝/沉默/重复直接用引擎软话，只有正常推进才请 AI。
 *
 * 用法：
 *   val conv = Conversation(client, session)
 *   conv.start()                       // 开场白 + 第一个问题（只调一次）
 *   val out = conv.say("小时候最常吃苞米面饼子")
 *   tts.speak(out.text)
 *   conv.close()                       // 收尾
 */
class Conversation(
    private val client: RenshengClient,
    var session: Session
) {

    var openingText: String = session.openingText()
        private set

    /** 进访谈：开场白。已有 openingText 就不再重复种问题。 */
    fun start(): String {
        if (openingText.isNotEmpty()) return openingText
        val opened = client.opening(session)
        session = opened.session
        val text = opened.result.optString("text", "咱们随便聊聊，想到哪儿说到哪儿。")
        session.setOpeningText(text)
        session.addTurn("ai", text)
        openingText = text
        return text
    }

    /** 老人说一句 → 返回 AI 该说的一句（已写进 session.turns）。 */
    fun say(text: String, audioId: String? = null, aiEnabled: Boolean = true): String {
        val t = text.trim()
        if (t.isEmpty()) return ""
        session.addTurn("elder", t, audioId)

        val r = client.respond(session, t, audioId)
        session = r.session

        var aiText = r.reply
        if (r.hasQuestion && aiEnabled) {
            aiText = try {
                client.aiNext(session, r.result, true).text
            } catch (e: RenshengException) {
                r.reply
            }
        }
        if (aiText.isBlank()) aiText = r.reply

        session.addTurn("ai", aiText)
        return aiText
    }

    /** 收尾。 */
    fun close(): String {
        val c = client.closing(session)
        session = c.session
        session.addTurn("ai", c.text)
        return c.text
    }
}
