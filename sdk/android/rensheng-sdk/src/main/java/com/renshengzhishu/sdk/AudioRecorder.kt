package com.renshengzhishu.sdk

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 录音工具：录 16k / 16bit / 单声道 PCM，输出 base64。
 * 这正是服务端 /api/v1/asr（讯飞 / FunASR）要的格式（audio/L16;rate=16000）。
 * 用法：
 *   val rec = AudioRecorder(context)
 *   if (rec.hasPermission()) rec.start()
 *   val pcmBase64 = rec.stop()   // 拿到底码，交给 client.asr(...)
 */
class AudioRecorder(private val context: Context) {

    private val sampleRate = 16000
    private val recording = AtomicBoolean(false)
    private var thread: Thread? = null
    private val buffer = ByteArrayOutputStream()

    fun hasPermission(): Boolean {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    fun start(): Boolean {
        if (recording.get()) return false
        if (!hasPermission()) return false
        buffer.reset()
        recording.set(true)

        val minBuf = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val record = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuf, sampleRate / 10)
        )
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            recording.set(false)
            return false
        }

        thread = Thread {
            record.startRecording()
            val buf = ByteArray(maxOf(minBuf, sampleRate / 10))
            while (recording.get()) {
                val n = record.read(buf, 0, buf.size)
                if (n > 0) buffer.write(buf, 0, n)
            }
            try { record.stop() } catch (_: Exception) {}
            record.release()
        }
        thread?.start()
        return true
    }

    /** 停止并返回 PCM base64（没有录到内容时返回空串）。 */
    fun stop(): String {
        if (!recording.getAndSet(false)) return ""
        thread?.join(2000)
        thread = null
        val bytes = buffer.toByteArray()
        return if (bytes.isEmpty()) "" else Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    fun isRecording(): Boolean = recording.get()
}
