package dev.fouruthent.agentremote

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

data class AppLockUiState(
    val enabled: Boolean = false,
    val locked: Boolean = false,
    val biometricEnabled: Boolean = false,
    val biometricAvailable: Boolean = false,
    val biometricLabel: String = "生体認証",
)

/**
 * App-level gate. This protects the UI, not the WebSocket token at rest:
 * the token remains in Android Keystore-encrypted preferences.
 */
class AppLock(context: Context) {
    private val appContext = context.applicationContext
    // The stored value is a salted PBKDF2 hash, not the password or the API
    // token. Keeping it in ordinary preferences avoids generating a Keystore
    // key on app startup (the token itself remains Keystore-encrypted).
    private val prefs: SharedPreferences =
        appContext.getSharedPreferences("agent_remote_lock", Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(readState())
    val state: StateFlow<AppLockUiState> = _state.asStateFlow()

    init {
        refreshBiometrics()
        if (prefs.getBoolean(KEY_ENABLED, false) && !hasSecret()) {
            prefs.edit().putBoolean(KEY_ENABLED, false).apply()
            _state.value = _state.value.copy(enabled = false, locked = false)
        }
    }

    fun refreshBiometrics() {
        // BIOMETRIC_WEAK is the compatibility set for API 26-29 (strong and
        // weak authenticators are combined by the platform on newer releases).
        val availability = BiometricManager.from(appContext)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) ==
            BiometricManager.BIOMETRIC_SUCCESS
        val current = _state.value
        val biometricEnabled = prefs.getBoolean(KEY_BIOMETRIC, false) && availability
        _state.value = current.copy(
            biometricAvailable = availability,
            biometricEnabled = biometricEnabled,
            biometricLabel = biometryLabel(),
        )
    }

    private fun biometryLabel(): String {
        val features = appContext.packageManager
        val face = features.hasSystemFeature(android.content.pm.PackageManager.FEATURE_FACE)
        val fingerprint = features.hasSystemFeature(android.content.pm.PackageManager.FEATURE_FINGERPRINT)
        return when {
            face && fingerprint -> "指紋 / 顔認証"
            face -> "顔認証"
            fingerprint -> "指紋認証"
            else -> "生体認証"
        }
    }

    fun enable(password: String) {
        require(password.length >= 6) { "アプリパスワードは6文字以上にしてください。" }
        require(password.length <= 128) { "アプリパスワードは128文字以内にしてください。" }
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val hash = derive(password, salt)
        prefs.edit()
            .putString(KEY_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
            .putString(KEY_HASH, Base64.encodeToString(hash, Base64.NO_WRAP))
            .putBoolean(KEY_ENABLED, true)
            .putBoolean(KEY_BIOMETRIC, _state.value.biometricAvailable)
            .apply()
        refreshBiometrics()
        _state.value = _state.value.copy(
            enabled = true,
            locked = false,
            biometricEnabled = _state.value.biometricAvailable,
        )
    }

    fun disable() {
        prefs.edit()
            .remove(KEY_SALT)
            .remove(KEY_HASH)
            .putBoolean(KEY_ENABLED, false)
            .putBoolean(KEY_BIOMETRIC, false)
            .apply()
        _state.value = _state.value.copy(enabled = false, locked = false, biometricEnabled = false)
    }

    fun setBiometricEnabled(enabled: Boolean) {
        if (!_state.value.enabled || (enabled && !_state.value.biometricAvailable)) return
        prefs.edit().putBoolean(KEY_BIOMETRIC, enabled).apply()
        _state.value = _state.value.copy(biometricEnabled = enabled)
    }

    fun onBackground() {
        if (_state.value.enabled) {
            _state.value = _state.value.copy(locked = true)
        }
    }

    fun verifyPassword(password: String): Boolean {
        if (!hasSecret()) return false
        val salt = Base64.decode(prefs.getString(KEY_SALT, "") ?: "", Base64.NO_WRAP)
        val expected = Base64.decode(prefs.getString(KEY_HASH, "") ?: "", Base64.NO_WRAP)
        val actual = derive(password, salt)
        if (!MessageDigest.isEqual(expected, actual)) return false
        _state.value = _state.value.copy(locked = false)
        return true
    }

    fun authenticate(activity: FragmentActivity, onError: (String) -> Unit = {}) {
        val current = _state.value
        if (!current.enabled || !current.biometricEnabled || !current.biometricAvailable) {
            onError("生体認証を利用できません。")
            return
        }
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    _state.value = _state.value.copy(locked = false)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                        errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                        errorCode == BiometricPrompt.ERROR_CANCELED
                    ) return
                    onError(errString.toString())
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Agent Remoteのロック解除")
            .setSubtitle("${current.biometricLabel}を認証してください")
            .setNegativeButtonText("アプリパスワード")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK)
            .setConfirmationRequired(false)
            .build()
        prompt.authenticate(info)
    }

    private fun hasSecret(): Boolean =
        !prefs.getString(KEY_SALT, null).isNullOrEmpty() &&
            !prefs.getString(KEY_HASH, null).isNullOrEmpty()

    private fun readState(): AppLockUiState {
        val enabled = prefs.getBoolean(KEY_ENABLED, false) && hasSecret()
        return AppLockUiState(
            enabled = enabled,
            locked = enabled,
            biometricEnabled = prefs.getBoolean(KEY_BIOMETRIC, false),
            biometricAvailable = false,
            biometricLabel = "生体認証",
        )
    }

    private fun derive(password: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    private companion object {
        const val KEY_ENABLED = "enabled"
        const val KEY_BIOMETRIC = "biometric"
        const val KEY_SALT = "salt"
        const val KEY_HASH = "hash"
        const val ITERATIONS = 120_000
    }
}
