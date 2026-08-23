package com.renshengzhishu.sdk

import android.content.Context
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * 朗读封装：把 AI 的话念给老人听（Android 原生 TTS，不需要服务端）。
 * 注意：引擎/传记都在服务端，TTS 是纯本地能力。
 */
class Tts(context: Context) {

    private var tts: TextToSpeech? = null
    private var ready = false

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            ready = status == TextToSpeech.SUCCESS
            if (ready) {
                tts?.language = Locale.CHINESE
                tts?.setSpeechRate(0.92f)
            }
        }
    }

    fun speak(text: String) {
        if (!ready || text.isBlank()) return
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "rsz_" + System.currentTimeMillis())
    }

    fun stop() {
        tts?.stop()
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
    }
}
