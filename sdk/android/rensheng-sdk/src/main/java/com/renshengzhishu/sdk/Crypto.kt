package com.renshengzhishu.sdk

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * 加密工具：给"人生之书"上锁（AES-256-GCM + PBKDF2-SHA256）。
 *
 * 文件格式与 web/js/crypto.js 完全一致，两端可以互开：
 *   base64( salt[16] + iv[12] + AES-GCM 密文 )
 *   PBKDF2-SHA256, 210000 次迭代, 256 位密钥
 *
 * 用途：导出整本书给家人时上锁；拿到加密文件 + 口令才能打开。
 */
object Crypto {

    private const val ITERATIONS = 210_000
    private const val SALT_LEN = 16
    private const val IV_LEN = 12
    private const val TAG_BITS = 128

    fun encrypt(plainText: String, password: String): String {
        require(password.isNotBlank()) { "口令不能为空" }
        val salt = ByteArray(SALT_LEN).also { SecureRandom().nextBytes(it) }
        val iv = ByteArray(IV_LEN).also { SecureRandom().nextBytes(it) }
        val key = deriveKey(password, salt)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        val ct = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))

        val out = ByteArray(SALT_LEN + IV_LEN + ct.size)
        System.arraycopy(salt, 0, out, 0, SALT_LEN)
        System.arraycopy(iv, 0, out, SALT_LEN, IV_LEN)
        System.arraycopy(ct, 0, out, SALT_LEN + IV_LEN, ct.size)
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    fun decrypt(payload: String, password: String): String {
        require(password.isNotBlank()) { "口令不能为空" }
        val data = Base64.decode(payload, Base64.NO_WRAP)
        require(data.size >= SALT_LEN + IV_LEN) { "文件格式不对" }

        val salt = data.copyOfRange(0, SALT_LEN)
        val iv = data.copyOfRange(SALT_LEN, SALT_LEN + IV_LEN)
        val ct = data.copyOfRange(SALT_LEN + IV_LEN, data.size)
        val key = deriveKey(password, salt)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        return try {
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            throw RenshengException("口令不对，打不开", RenshengException.CODE_UNKNOWN, 0)
        }
    }

    private fun deriveKey(password: String, salt: ByteArray): SecretKeySpec {
        val spec = PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return SecretKeySpec(factory.generateSecret(spec).encoded, "AES")
    }
}
