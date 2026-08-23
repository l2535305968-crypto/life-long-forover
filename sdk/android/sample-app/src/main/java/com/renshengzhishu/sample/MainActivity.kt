package com.renshengzhishu.sample

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.renshengzhishu.sdk.AudioRecorder
import com.renshengzhishu.sdk.Conversation
import com.renshengzhishu.sdk.RenshengClient
import com.renshengzhishu.sdk.Session
import com.renshengzhishu.sdk.SessionStore
import com.renshengzhishu.sdk.Tts

/**
 * 《人生之书》示例 App：演示 SDK 的完整接入方式。
 *   - 连接家里的服务端（电脑上 node server/server.mjs）
 *   - 新建 / 打开一本书 → 开场白 → 陪聊（文字或按住说话）→ 收尾
 *   - 生成传记、导出加密文件
 *
 * 真机联调要点：
 *   1. 手机和电脑在同一个 WiFi。
 *   2. 把 SERVER_URL 改成电脑的局域网地址（服务启动时会打印 http://192.168.x.x:8788）。
 *   3. 语音识别需要服务端配了讯飞 Key 或本地 FunASR（.env 里配），否则打字也能聊。
 */
class MainActivity : Activity() {

    private lateinit var store: SessionStore
    private lateinit var tts: Tts
    private lateinit var recorder: AudioRecorder
    private var client: RenshengClient? = null
    private var conversation: Conversation? = null
    private var session: Session? = null

    private lateinit var logView: TextView
    private lateinit var input: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        store = SessionStore(this)
        tts = Tts(this)
        recorder = AudioRecorder(this)

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }

        buildUi()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }

        val urlRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val urlInput = EditText(this).apply {
            hint = "服务端地址，如 http://192.168.1.5:8788"
            text = SERVER_URL
        }
        urlRow.addView(urlInput, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        urlRow.addView(Button(this).apply {
            text = "连接"
            setOnClickListener {
                val url = urlInput.text.toString().trim().ifEmpty { SERVER_URL }
                log("连接 " + url + " …")
                runOnIo {
                    try {
                        val c = RenshengClient(url)
                        val h = c.health()
                        client = c
                        log("已连接。模型 " + h.optString("model", "?") + "，AI 在线 " + h.optBoolean("hasKey", false))
                    } catch (e: Exception) {
                        log("连接失败：" + (e.message ?: ""))
                    }
                }
            }
        })
        root.addView(urlRow)

        val nameRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val nameInput = EditText(this).apply {
            hint = "称呼，如：姥爷"
            text = store.listSummaries().firstOrNull()?.optString("name") ?: ""
        }
        nameRow.addView(nameInput, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        nameRow.addView(Button(this).apply {
            text = "开聊"
            setOnClickListener {
                val name = nameInput.text.toString().trim()
                runOnIo {
                    try {
                        val c = client ?: throw IllegalStateException("先点连接")
                        val s = session ?: c.newSession(name.ifEmpty { "老人" }, "putonghua")
                        session = s
                        conversation = Conversation(c, s)
                        val opening = conversation!!.start()
                        log("开场：" + opening)
                        tts.speak(opening)
                        store.save(conversation!!.session)
                        log("已存书 " + conversation!!.session.id)
                    } catch (e: Exception) {
                        log("开聊失败：" + (e.message ?: ""))
                    }
                }
            }
        })
        root.addView(nameRow)

        logView = TextView(this).apply {
            textSize = 14f
            setPadding(0, 16, 0, 16)
        }
        val scroll = ScrollView(this).apply { addView(logView) }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        input = EditText(this).apply { hint = "老人说了啥，敲进来（或按住下面说话）" }
        root.addView(input)

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(Button(this).apply {
            text = "发送"
            setOnClickListener {
                val text = input.text.toString().trim()
                input.setText("")
                if (text.isEmpty()) return@setOnClickListener
                runOnIo {
                    try {
                        val conv = conversation ?: throw IllegalStateException("先点开聊")
                        val ai = conv.say(text)
                        log("老人：" + text + "\nAI：" + ai)
                        tts.speak(ai)
                        store.save(conv.session)
                    } catch (e: Exception) {
                        log("发送失败：" + (e.message ?: ""))
                    }
                }
            }
        })
        row.addView(Button(this).apply {
            text = "按住说话"
            setOnTouchListener { _, ev ->
                when (ev.action) {
                    android.view.MotionEvent.ACTION_DOWN -> {
                        if (recorder.hasPermission()) recorder.start()
                    }
                    android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> {
                        if (recorder.isRecording()) {
                            val pcm = recorder.stop()
                            if (pcm.isNotEmpty()) {
                                runOnIo {
                                    try {
                                        val c = client ?: throw IllegalStateException("先点连接")
                                        val text = c.asr(pcm, session?.dialect() ?: "putonghua")
                                        log("识别：" + text)
                                        if (text.isNotEmpty()) {
                                            val conv = conversation ?: throw IllegalStateException("先点开聊")
                                            val ai = conv.say(text)
                                            log("AI：" + ai)
                                            tts.speak(ai)
                                            store.save(conv.session)
                                        }
                                    } catch (e: Exception) {
                                        log("语音失败：" + (e.message ?: ""))
                                    }
                                }
                            }
                        }
                    }
                }
                true
            }
        })
        root.addView(row)

        val row2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row2.addView(Button(this).apply {
            text = "传记"
            setOnClickListener {
                runOnIo {
                    try {
                        val conv = conversation ?: throw IllegalStateException("先点开聊")
                        val bio = client!!.bioRender(conv.session)
                        log("传记（本地整理版）：\n" + bio.text)
                    } catch (e: Exception) {
                        log("传记失败：" + (e.message ?: ""))
                    }
                }
            }
        })
        row2.addView(Button(this).apply {
            text = "收尾"
            setOnClickListener {
                runOnIo {
                    try {
                        val conv = conversation ?: throw IllegalStateException("先点开聊")
                        val text = conv.close()
                        log("收尾：" + text)
                        tts.speak(text)
                        store.save(conv.session)
                    } catch (e: Exception) {
                        log("收尾失败：" + (e.message ?: ""))
                    }
                }
            }
        })
        root.addView(row2)

        setContentView(root)
    }

    private fun runOnIo(block: () -> Unit) {
        Thread(block).start()
    }

    private fun log(text: String) {
        runOnUiThread {
            logView.append(text + "\n\n")
            logView.post { (logView.parent as? ScrollView)?.fullScroll(android.view.View.FOCUS_DOWN) }
        }
    }

    companion object {
        // TODO: 改成你家电脑的局域网地址（服务启动横幅里会打印）
        private const val SERVER_URL = "http://192.168.1.5:8788"
    }
}
