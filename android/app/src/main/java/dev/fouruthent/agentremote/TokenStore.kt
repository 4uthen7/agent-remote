package dev.fouruthent.agentremote

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class TokenStore(context: Context) {
    private val prefs: SharedPreferences = runCatching {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "agent_remote_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrElse {
        context.getSharedPreferences("agent_remote_fallback", Context.MODE_PRIVATE)
    }

    var serverUrl: String
        get() = prefs.getString(KEY_URL, "") ?: ""
        set(value) = prefs.edit().putString(KEY_URL, value).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var lastCwd: String
        get() = prefs.getString(KEY_CWD, "~/Documents") ?: "~/Documents"
        set(value) = prefs.edit().putString(KEY_CWD, value).apply()

    var selectedRuntime: String
        get() = prefs.getString(KEY_RUNTIME, "dsh") ?: "dsh"
        set(value) = prefs.edit().putString(KEY_RUNTIME, value).apply()

    private companion object {
        const val KEY_URL = "server_url"
        const val KEY_TOKEN = "token"
        const val KEY_CWD = "last_cwd"
        const val KEY_RUNTIME = "selected_runtime"
    }
}
