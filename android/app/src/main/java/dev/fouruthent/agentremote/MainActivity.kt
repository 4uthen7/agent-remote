package dev.fouruthent.agentremote

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle

class MainActivity : ComponentActivity() {
    private val store: AgentStore by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { AgentRemoteApp(store) }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val data = intent?.dataString
        if (!data.isNullOrBlank()) store.applyPairing(data)
    }
}

@Composable
fun AgentRemoteApp(store: AgentStore) {
    val state by store.state.collectAsStateWithLifecycle()
    var showGuide by rememberSaveable { mutableStateOf(false) }
    AgentTheme {
        Surface(
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            color = MaterialTheme.colorScheme.background,
        ) {
            Box(Modifier.fillMaxSize().systemBarsPadding()) {
                when (state.route) {
                    Route.Connect -> ConnectScreen(state, store) { showGuide = true }
                    Route.Sessions -> SessionsScreen(state, store) { showGuide = true }
                    Route.NewSession -> NewSessionScreen(state, store)
                    Route.Timeline -> TimelineScreen(state, store) { showGuide = true }
                    Route.Settings -> SettingsScreen(state, store)
                }
                if (showGuide) {
                    GuideSheet(
                        state = state,
                        onDismiss = { showGuide = false },
                        onAction = { action ->
                            when (action) {
                                GuideAction.OpenConnect -> store.openConnect()
                                GuideAction.Connect -> store.connect()
                                GuideAction.OpenNewSession -> store.openNewSession()
                                GuideAction.None -> Unit
                            }
                            showGuide = false
                        },
                    )
                }
            }
        }
    }
}
