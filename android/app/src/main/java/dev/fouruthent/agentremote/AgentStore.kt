package dev.fouruthent.agentremote

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONObject

data class UiState(
    val route: Route = Route.Connect,
    val connection: ConnectionState = ConnectionState.Disconnected,
    val host: String = "",
    val version: String = "",
    val sessions: List<SessionSummary> = emptyList(),
    val currentSession: SessionSummary? = null,
    val events: List<AgentEvent> = emptyList(),
    val approvals: List<Approval> = emptyList(),
    val activeApproval: Approval? = null,
    val configOptions: List<ConfigOption> = emptyList(),
    val contextFraction: Double = 0.0,
    val lastError: String? = null,
    val pendingCreate: Boolean = false,
    val serverUrl: String = "",
    val token: String = "",
    val lastCwd: String = "~/Documents",
    val selectedRuntime: String = "dsh",
) {
    val isConnected: Boolean get() = connection == ConnectionState.Connected
    val modelOption: ConfigOption? get() = configOptions.firstOrNull { it.id == "model" }
    val modelLabel: String
        get() = modelOption?.selectedLabel ?: currentSession?.displayModel ?: "モデル"
    val timeline: List<TimelineItem> get() = buildTimeline(events)
}

class AgentStore(application: Application) : AndroidViewModel(application) {
    private val prefs = TokenStore(application)
    private val _state = MutableStateFlow(
        UiState(
            serverUrl = prefs.serverUrl,
            token = prefs.token,
            lastCwd = prefs.lastCwd,
            selectedRuntime = prefs.selectedRuntime,
            route = Route.Connect,
        )
    )
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var client: AgentClient? = null
    private var pendingCreate = false

    init {
        val current = _state.value
        if (current.serverUrl.isNotBlank() && current.token.isNotBlank()) connect()
    }

    fun setServerUrl(value: String) {
        prefs.serverUrl = value
        _state.update { it.copy(serverUrl = value) }
    }

    fun setToken(value: String) {
        prefs.token = value
        _state.update { it.copy(token = value) }
    }

    fun setCwd(value: String) {
        prefs.lastCwd = value
        _state.update { it.copy(lastCwd = value) }
    }

    fun setRuntime(value: String) {
        prefs.selectedRuntime = value
        _state.update { it.copy(selectedRuntime = value) }
    }

    fun clearError() {
        _state.update { it.copy(lastError = null) }
    }

    fun connect() {
        val current = _state.value
        if (current.serverUrl.isBlank()) {
            _state.update { it.copy(lastError = "ホストURLを入力してください", route = Route.Connect) }
            return
        }
        if (current.token.isBlank()) {
            _state.update { it.copy(lastError = "トークンを入力してください", route = Route.Connect) }
            return
        }
        client?.close()
        _state.update { it.copy(connection = ConnectionState.Connecting, route = Route.Connect, lastError = null) }
        val next = AgentClient(object : AgentClient.Listener {
            override fun onOpen() = sendHello()
            override fun onMessage(text: String) {
                runCatching { handleMessage(JSONObject(text)) }
                    .onFailure { _state.update { s -> s.copy(lastError = "応答を解析できません: ${it.message}") } }
            }
            override fun onClosed(reason: String) {
                _state.update { it.copy(connection = ConnectionState.Failed, route = Route.Connect, lastError = reason) }
            }
            override fun onFailure(error: String) {
                _state.update { it.copy(connection = ConnectionState.Failed, route = Route.Connect, lastError = error) }
            }
        })
        client = next
        next.connect(current.serverUrl)
    }

    private fun sendHello() {
        val current = _state.value
        send("hello") {
            it.put("token", current.token)
            it.put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL} / Android")
        }
    }

    fun applyPairing(text: String) {
        val pair = Json.pairFromUri(text)
        if (pair == null) {
            _state.update { it.copy(lastError = "QRコードを読み取れませんでした") }
            return
        }
        val (url, token) = pair
        if (url.isNotBlank()) setServerUrl(url)
        if (token.isNotBlank()) setToken(token)
        _state.update { it.copy(route = Route.Connect, lastError = null) }
        if (_state.value.serverUrl.isNotBlank() && _state.value.token.isNotBlank()) connect()
    }

    fun openNewSession() {
        pendingCreate = false
        _state.update {
            it.copy(
                route = Route.NewSession,
                currentSession = null,
                events = emptyList(),
                approvals = emptyList(),
                activeApproval = null,
                configOptions = emptyList(),
                pendingCreate = false,
            )
        }
    }

    fun createSession(cwd: String, runtime: String) {
        val trimmed = cwd.trim()
        if (trimmed.isEmpty()) {
            _state.update { it.copy(lastError = "作業ディレクトリを入力してください") }
            return
        }
        prefs.lastCwd = trimmed
        prefs.selectedRuntime = runtime
        pendingCreate = true
        _state.update {
            it.copy(
                lastCwd = trimmed,
                selectedRuntime = runtime,
                pendingCreate = true,
                route = Route.NewSession,
                currentSession = null,
                events = emptyList(),
                approvals = emptyList(),
                activeApproval = null,
                configOptions = emptyList(),
                lastError = null,
            )
        }
        send("create_session") {
            it.put("cwd", trimmed)
            it.put("runtime", runtime)
        }
    }

    fun openSession(session: SessionSummary) {
        pendingCreate = false
        _state.update {
            it.copy(
                route = Route.Timeline,
                currentSession = session,
                events = emptyList(),
                approvals = emptyList(),
                activeApproval = null,
                configOptions = emptyList(),
                lastError = null,
            )
        }
        send("subscribe") { it.put("sessionId", session.id) }
    }

    fun resumeSession(session: SessionSummary) {
        if (session.archived && !session.resumable) {
            _state.update {
                it.copy(lastError = "このセッションは ${session.originHost ?: "別のホスト"} のものです。そのホストに接続してください。")
            }
            return
        }
        pendingCreate = true
        _state.update {
            it.copy(
                route = Route.Timeline,
                currentSession = session,
                events = emptyList(),
                approvals = emptyList(),
                activeApproval = null,
                configOptions = emptyList(),
                lastError = null,
            )
        }
        send("resume_session") {
            it.put("sessionId", session.id)
            it.put("cwd", session.cwd)
            it.put("runtime", session.runtime)
        }
    }

    fun resumeCurrentSession() {
        _state.value.currentSession?.let(::resumeSession)
    }

    fun openSettings() {
        _state.update { it.copy(route = Route.Settings) }
    }

    fun openConnect() {
        _state.update { it.copy(route = Route.Connect, lastError = null) }
    }

    fun back() {
        _state.update {
            when (it.route) {
                Route.Timeline, Route.NewSession, Route.Settings -> it.copy(
                    route = Route.Sessions,
                    currentSession = null,
                    events = emptyList(),
                    approvals = emptyList(),
                    activeApproval = null,
                )
                else -> it
            }
        }
    }

    fun refreshSessions() {
        send("list_sessions")
    }

    fun sendPrompt(text: String) {
        val session = _state.value.currentSession ?: return
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        _state.update {
            it.copy(lastError = null, currentSession = it.currentSession?.copy(status = "running"))
        }
        send("prompt") {
            it.put("sessionId", session.id)
            it.put("text", trimmed)
        }
    }

    fun cancel() {
        val session = _state.value.currentSession ?: return
        send("cancel") { it.put("sessionId", session.id) }
        _state.update { it.copy(currentSession = it.currentSession?.copy(status = "idle")) }
    }

    fun setModel(value: String) {
        val session = _state.value.currentSession ?: return
        send("set_model") {
            it.put("sessionId", session.id)
            it.put("value", value)
        }
        _state.update { state ->
            val options = state.configOptions.map { option ->
                if (option.id == "model") option.copy(currentValue = value) else option
            }
            val model = options.firstOrNull { it.id == "model" }?.selectedLabel ?: value
            state.copy(
                configOptions = options,
                currentSession = state.currentSession?.copy(model = model),
            )
        }
    }

    fun approve(approval: Approval, optionId: String) {
        send("approve") {
            it.put("approvalId", approval.id)
            it.put("optionId", optionId)
        }
        _state.update { state ->
            val remaining = state.approvals.filterNot { it.id == approval.id }
            state.copy(
                approvals = remaining,
                activeApproval = remaining.firstOrNull(),
                currentSession = state.currentSession?.copy(status = "running"),
            )
        }
    }

    fun closeCurrentSession() {
        val session = _state.value.currentSession ?: return
        send("close_session") { it.put("sessionId", session.id) }
        _state.update {
            it.copy(
                route = Route.Sessions,
                currentSession = null,
                events = emptyList(),
                approvals = emptyList(),
                activeApproval = null,
            )
        }
    }

    fun disconnect() {
        client?.close()
        client = null
        pendingCreate = false
        _state.update {
            it.copy(
                connection = ConnectionState.Disconnected,
                route = Route.Connect,
                sessions = emptyList(),
                currentSession = null,
                events = emptyList(),
                approvals = emptyList(),
                activeApproval = null,
                configOptions = emptyList(),
                lastError = null,
            )
        }
    }

    private fun send(type: String, build: (JSONObject) -> Unit = {}) {
        val socket = client
        if (socket == null) {
            _state.update { it.copy(lastError = "接続されていません") }
            return
        }
        val payload = JSONObject().put("type", type)
        build(payload)
        if (!socket.send(payload.toString())) {
            _state.update { it.copy(lastError = "送信に失敗しました") }
        }
    }

    private fun handleMessage(message: JSONObject) {
        when (message.optString("type")) {
            "hello_ok" -> {
                val host = message.optJSONObject("host")
                val hostName = host?.optString("name").orEmpty().ifBlank { message.optString("hostName") }
                val version = host?.optString("version").orEmpty().ifBlank { message.optString("version") }
                val sessions = Json.parseSessions(Json.array(message, "sessions"))
                _state.update {
                    it.copy(
                        connection = ConnectionState.Connected,
                        host = hostName,
                        version = version,
                        sessions = sessions,
                        route = if (it.route == Route.Connect) Route.Sessions else it.route,
                        lastError = null,
                    )
                }
            }
            "sessions" -> _state.update { it.copy(sessions = Json.parseSessions(Json.array(message, "sessions"))) }
            "session" -> {
                val session = Json.objectOrNull(message, "session")?.let { Json.parseSession(it) } ?: return
                upsert(session)
            }
            "snapshot" -> {
                val snapshot = Json.parseSnapshot(message) ?: return
                upsert(snapshot.session)
                val shouldOpen = pendingCreate
                if (shouldOpen) pendingCreate = false
                _state.update {
                    it.copy(
                        currentSession = snapshot.session,
                        events = snapshot.events,
                        approvals = snapshot.approvals,
                        activeApproval = snapshot.approvals.firstOrNull(),
                        configOptions = snapshot.configOptions,
                        route = if (shouldOpen || it.route == Route.NewSession) Route.Timeline else it.route,
                        pendingCreate = false,
                        lastError = null,
                    )
                }
            }
            "event" -> {
                val sessionId = message.optString("sessionId")
                val current = _state.value.currentSession?.id
                if (sessionId.isBlank() || sessionId != current) return
                val event = Json.objectOrNull(message, "event")?.let { Json.parseEvent(it) } ?: return
                applyEvent(event)
            }
            "approval" -> {
                val approval = Json.objectOrNull(message, "approval")?.let { Json.parseApproval(it) } ?: return
                _state.update { state ->
                    if (state.approvals.any { it.id == approval.id }) state
                    else state.copy(
                        approvals = state.approvals + approval,
                        activeApproval = state.activeApproval ?: approval,
                        currentSession = state.currentSession?.copy(status = "awaiting_approval"),
                    )
                }
            }
            "approval_resolved" -> {
                val id = message.optString("approvalId")
                _state.update { state ->
                    val remaining = state.approvals.filterNot { it.id == id }
                    state.copy(
                        approvals = remaining,
                        activeApproval = remaining.firstOrNull(),
                        currentSession = if (state.currentSession?.status == "awaiting_approval")
                            state.currentSession.copy(status = "running") else state.currentSession,
                    )
                }
            }
            "config", "models" -> {
                val options = Json.parseConfigOptions(Json.array(message, "configOptions"))
                val explicitModel = Json.string(message, "model")
                _state.update { state ->
                    val model = explicitModel ?: options.firstOrNull { it.id == "model" }?.selectedLabel ?: state.currentSession?.model
                    state.copy(
                        configOptions = options,
                        currentSession = state.currentSession?.copy(model = model),
                    )
                }
            }
            "session_removed" -> {
                val id = message.optString("sessionId")
                _state.update { state ->
                    val remaining = state.sessions.filterNot { it.id == id }
                    if (state.currentSession?.id == id) {
                        state.copy(
                            sessions = remaining,
                            route = Route.Sessions,
                            currentSession = null,
                            events = emptyList(),
                            approvals = emptyList(),
                            activeApproval = null,
                        )
                    } else state.copy(sessions = remaining)
                }
            }
            "error" -> _state.update { it.copy(lastError = Json.string(message, "message") ?: "エラーが発生しました") }
        }
    }

    private fun upsert(session: SessionSummary) {
        _state.update { state ->
            val index = state.sessions.indexOfFirst { it.id == session.id }
            val sessions = state.sessions.toMutableList()
            if (index >= 0) sessions[index] = session else sessions += session
            sessions.sortByDescending { it.updatedAt }
            state.copy(
                sessions = sessions,
                currentSession = if (state.currentSession?.id == session.id) session else state.currentSession,
            )
        }
    }

    private fun applyEvent(event: AgentEvent) {
        _state.update { state ->
            var fraction = state.contextFraction
            if (event.type == "usage" && event.size != null && event.size > 0) {
                fraction = ((event.used ?: 0L).toDouble() / event.size.toDouble()).coerceIn(0.0, 1.0)
            }
            val status = when (event.type) {
                "user_message", "assistant_delta", "thought_delta", "tool_call", "tool_update" -> "running"
                "turn_end" -> "idle"
                "error" -> "error"
                else -> state.currentSession?.status ?: "idle"
            }
            state.copy(
                events = state.events + event,
                contextFraction = fraction,
                currentSession = state.currentSession?.copy(status = status),
            )
        }
    }

    override fun onCleared() {
        client?.close()
        client = null
        super.onCleared()
    }
}
