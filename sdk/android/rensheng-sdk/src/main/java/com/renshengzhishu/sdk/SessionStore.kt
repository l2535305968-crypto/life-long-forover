package com.renshengzhishu.sdk

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 本地书库：书只存在这台手机自己的私有存储里（SharedPreferences JSON），不上传。
 * 与 web 前端的 IndexedDB 职责一致，schema 相同，可通过加密导出/导入互通。
 */
class SessionStore(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("renshengzhishu_books", Context.MODE_PRIVATE)
    private val KEY_IDS = "book_ids"

    /** 保存 / 更新一本书。 */
    fun save(session: Session): Session {
        prefs.edit().putString(session.id, session.toJsonString()).apply()
        val ids = listIds()
        if (!ids.contains(session.id)) {
            ids.add(session.id)
            prefs.edit().putString(KEY_IDS, JSONArray(ids).toString()).apply()
        }
        return session
    }

    fun load(id: String): Session? {
        val text = prefs.getString(id, null) ?: return null
        return try {
            Session.fromJson(text)
        } catch (e: Exception) {
            null
        }
    }

    fun delete(id: String) {
        prefs.edit().remove(id).apply()
        val ids = listIds().filter { it != id }
        prefs.edit().putString(KEY_IDS, JSONArray(ids).toString()).apply()
    }

    fun listIds(): MutableList<String> {
        val raw = prefs.getString(KEY_IDS, null) ?: return mutableListOf()
        return try {
            val arr = JSONArray(raw)
            val out = mutableListOf<String>()
            for (i in 0 until arr.length()) out.add(arr.getString(i))
            out
        } catch (e: Exception) {
            mutableListOf()
        }
    }

    /** 全部书的简要列表（书架用）。 */
    fun listSummaries(): List<JSONObject> {
        return listIds().mapNotNull { id ->
            val s = load(id) ?: return@mapNotNull null
            JSONObject()
                .put("id", s.id)
                .put("name", s.personName())
                .put("dialect", s.dialect())
                .put("updatedAt", s.json.optString("updatedAt", ""))
                .put("turns", s.turnCount())
        }.sortedByDescending { it.optString("updatedAt", "") }
    }
}
