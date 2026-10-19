package dev.fouruthent.agentremote

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner

class AgentRemoteApplication : Application() {
    lateinit var appLock: AppLock
        private set

    override fun onCreate() {
        super.onCreate()
        appLock = AppLock(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                // Enrollment can change while the app is in the background.
                appLock.refreshBiometrics()
            }

            override fun onStop(owner: LifecycleOwner) {
                // ON_STOP here means the whole app left the foreground. The QR
                // scanner and BiometricPrompt do not trip this process lifecycle.
                appLock.onBackground()
            }
        })
    }
}
