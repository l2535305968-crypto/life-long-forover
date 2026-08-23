package com.renshengzhishu.sdk

/**
 * 《人生之书》SDK 统一异常。
 * code 与服务端错误码一一对应（见 docs/08-SDK接入.md 的错误码表）。
 */
class RenshengException(
    message: String,
    val code: String = CODE_UNKNOWN,
    val status: Int = 0
) : Exception(message) {

    companion object {
        const val CODE_NETWORK = "NETWORK"
        const val CODE_UNKNOWN = "UNKNOWN"
        const val CODE_RATE = "RATE"
        const val CODE_NO_KEY = "NO_KEY"
        const val CODE_NO_ASR_KEY = "NO_ASR_KEY"
        const val CODE_BAD_SESSION = "BAD_SESSION"
        const val CODE_BAD_TEXT = "BAD_TEXT"
        const val CODE_BAD_JSON = "BAD_JSON"
        const val CODE_BAD_MESSAGES = "BAD_MESSAGES"
        const val CODE_BAD_AUDIO = "BAD_AUDIO"
        const val CODE_TOO_LARGE = "TOO_LARGE"
        const val CODE_EMPTY = "EMPTY"
        const val CODE_METHOD = "METHOD"
        const val CODE_NOT_FOUND = "NOT_FOUND"
        const val CODE_INTERNAL = "INTERNAL"
    }
}
