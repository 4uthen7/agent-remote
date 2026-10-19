package dev.fouruthent.agentremote

import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

data class HostInfo(val name: String, val version: String, val platform: String)

data class SessionSummary(
    val id: String,
    val title: String,
    val cwd: String,
    val status: String,
    val runtime: String,
    val model: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val archived: Boolean = false,
    val resumable: Boolean = true,
    val originHost: String? = null,
    val lastMessage: String? = null,
) {
    val isRunning: Boolean get() = status == "running" || status == "awaiting_approval"
    val displayModel: String get() = model?.takeIf { it.isNotBlank() } ?: "default"
    val runtimeLabel: String
        get() = when (runtime) {
            "codex" -> "Codex"
            "claude" -> "Claude"
            else -> "DSH"
        }
    val folderName: String
        get() = cwd.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\').ifBlank { cwd }
    val statusLabel: String
        get() = if (archived) {
            if (resumable) "終了・再開可能" else "別ホストの履歴"
        } else when (status) {
            "running" -> "実行中"
            "awaiting_approval" -> "承認待ち"
            "error" -> "エラー"
            else -> "待機中"
        }
}

data class AgentEvent(
    val seq: Int,
    val type: String,
    val text: String? = null,
    val message: String? = null,
    val toolCallId: String? = null,
    val title: String? = null,
    val kind: String? = null,
    val command: String? = null,
    val cwd: String? = null,
    val status: String? = null,
    val output: String? = null,
    val used: Long? = null,
    val size: Long? = null,
    val stopReason: String? = null,
) {
    val id: Int get() = seq
}

data class ApprovalOption(
    val optionId: String,
    val name: String,
    val kind: String?,
) {
    val isDestructive: Boolean
        get() = kind?.contains("reject") == true || optionId.contains("reject") || optionId == "deny"
    val label: String
        get() = when {
            isDestructive -> "拒否"
            optionId == "accept" || optionId == "allow" || optionId == "allow-once" -> "一度だけ許可"
            else -> name
        }
}

data class Approval(
    val id: String,
    val sessionId: String,
    val toolCallId: String?,
    val title: String,
    val command: String?,
    val cwd: String?,
    val justification: String?,
    val sandbox: String?,
    val kind: String?,
    val options: List<ApprovalOption>,
    val createdAt: Long,
) {
    val isDangerous: Boolean get() = sandbox?.contains("danger-full-access") == true
}

data class ConfigValue(val value: String, val name: String, val description: String?) {
    val id: String get() = value
}

sealed class ConfigEntry {
    data class Value(val item: ConfigValue) : ConfigEntry()
    data class Group(val group: String, val name: String?, val options: List<ConfigValue>) : ConfigEntry()
}

data class ConfigOption(
    val id: String,
    val name: String,
    val category: String?,
    val type: String,
    val currentValue: String?,
    val options: List<ConfigEntry>?,
) {
    val flatValues: List<ConfigValue>
        get() = options.orEmpty().flatMap { entry ->
            when (entry) {
                is ConfigEntry.Value -> listOf(entry.item)
                is ConfigEntry.Group -> entry.options
            }
        }
    val selected: ConfigValue?
        get() = flatValues.firstOrNull { it.value == currentValue }
    val selectedLabel: String?
        get() = selected?.name ?: currentValue
}

data class Snapshot(
    val session: SessionSummary,
    val events: List<AgentEvent>,
    val approvals: List<Approval>,
    val configOptions: List<ConfigOption>,
)

enum class Route { Connect, Sessions, NewSession, Timeline, Settings }
enum class ConnectionState { Disconnected, Connecting, Connected, Failed }

enum class TimelineKind { User, Assistant, Thought, Tool, Notice, Error }

data class TimelineItem(
    val id: String,
    val kind: TimelineKind,
    val text: String = "",
    val toolCallId: String? = null,
    val title: String? = null,
    val command: String? = null,
    val cwd: String? = null,
    val status: String? = null,
    val output: String? = null,
    val streaming: Boolean = false,
)

object Json {
    fun string(o: JSONObject?, key: String): String? {
        if (o == null || !o.has(key) || o.isNull(key)) return null
        return o.optString(key).takeIf { it.isNotEmpty() }
    }

    fun long(o: JSONObject?, key: String): Long? {
        if (o == null || !o.has(key) || o.isNull(key)) return null
        return o.optLong(key)
    }

    fun int(o: JSONObject?, key: String): Int? {
        if (o == null || !o.has(key) || o.isNull(key)) return null
        return o.optInt(key)
    }

    fun objectOrNull(o: JSONObject?, key: String): JSONObject? {
        if (o == null || !o.has(key) || o.isNull(key)) return null
        return o.optJSONObject(key)
    }

    fun array(o: JSONObject?, key: String): JSONArray? {
        if (o == null || !o.has(key) || o.isNull(key)) return null
        return o.optJSONArray(key)
    }

    fun parseSession(o: JSONObject): SessionSummary = SessionSummary(
        id = o.optString("id"),
        title = o.optString("title", "Session"),
        cwd = o.optString("cwd", ""),
        status = o.optString("status", "idle"),
        runtime = o.optString("runtime", "dsh"),
        model = string(o, "model"),
        createdAt = long(o, "createdAt") ?: 0L,
        updatedAt = long(o, "updatedAt") ?: 0L,
        archived = o.optBoolean("archived", false),
        resumable = if (o.has("resumable")) o.optBoolean("resumable", true) else true,
        originHost = string(o, "originHost"),
        lastMessage = string(o, "lastMessage"),
    )

    fun parseSessions(a: JSONArray?): List<SessionSummary> {
        if (a == null) return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            a.optJSONObject(i)?.let { runCatching { parseSession(it) }.getOrNull() }
        }
    }

    fun parseEvent(o: JSONObject): AgentEvent = AgentEvent(
        seq = int(o, "seq") ?: 0,
        type = o.optString("type", "notice"),
        text = string(o, "text"),
        message = string(o, "message"),
        toolCallId = string(o, "toolCallId"),
        title = string(o, "title"),
        kind = string(o, "kind"),
        command = string(o, "command"),
        cwd = string(o, "cwd"),
        status = string(o, "status"),
        output = string(o, "output"),
        used = long(o, "used"),
        size = long(o, "size"),
        stopReason = string(o, "stopReason"),
    )

    fun parseEvents(a: JSONArray?): List<AgentEvent> {
        if (a == null) return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            a.optJSONObject(i)?.let { runCatching { parseEvent(it) }.getOrNull() }
        }
    }

    fun parseApproval(o: JSONObject): Approval {
        val options = array(o, "options").let { a ->
            if (a == null) emptyList() else (0 until a.length()).mapNotNull { i ->
                a.optJSONObject(i)?.let {
                    ApprovalOption(
                        optionId = it.optString("optionId"),
                        name = it.optString("name", "Option"),
                        kind = string(it, "kind"),
                    )
                }
            }
        }.ifEmpty {
            listOf(
                ApprovalOption("allow-once", "Allow once", "allow_once"),
                ApprovalOption("reject-once", "Reject", "reject_once"),
            )
        }
        return Approval(
            id = o.optString("id"),
            sessionId = o.optString("sessionId"),
            toolCallId = string(o, "toolCallId"),
            title = o.optString("title", "Approval"),
            command = string(o, "command"),
            cwd = string(o, "cwd"),
            justification = string(o, "justification"),
            sandbox = string(o, "sandbox"),
            kind = string(o, "kind"),
            options = options,
            createdAt = long(o, "createdAt") ?: System.currentTimeMillis(),
        )
    }

    fun parseApprovals(a: JSONArray?): List<Approval> {
        if (a == null) return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            a.optJSONObject(i)?.let { runCatching { parseApproval(it) }.getOrNull() }
        }
    }

    fun parseConfigValue(o: JSONObject): ConfigValue = ConfigValue(
        value = o.optString("value"),
        name = o.optString("name", o.optString("value")),
        description = string(o, "description"),
    )

    fun parseConfigEntries(a: JSONArray?): List<ConfigEntry> {
        if (a == null) return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            val o = a.optJSONObject(i) ?: return@mapNotNull null
            val group = string(o, "group")
            val options = array(o, "options")
            if (!group.isNullOrEmpty() && options != null) {
                ConfigEntry.Group(
                    group = group,
                    name = string(o, "name"),
                    options = (0 until options.length()).mapNotNull { j ->
                        options.optJSONObject(j)?.let { runCatching { parseConfigValue(it) }.getOrNull() }
                    },
                )
            } else {
                ConfigEntry.Value(parseConfigValue(o))
            }
        }
    }

    fun parseConfigOptions(a: JSONArray?): List<ConfigOption> {
        if (a == null) return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            val o = a.optJSONObject(i) ?: return@mapNotNull null
            ConfigOption(
                id = o.optString("id"),
                name = o.optString("name", o.optString("id")),
                category = string(o, "category"),
                type = o.optString("type", "select"),
                currentValue = string(o, "currentValue"),
                options = parseConfigEntries(array(o, "options")),
            )
        }
    }

    fun parseSnapshot(o: JSONObject): Snapshot? {
        val session = objectOrNull(o, "session")?.let { runCatching { parseSession(it) }.getOrNull() } ?: return null
        return Snapshot(
            session = session,
            events = parseEvents(array(o, "events")),
            approvals = parseApprovals(array(o, "approvals")),
            configOptions = parseConfigOptions(array(o, "configOptions")),
        )
    }

    fun relativeTime(epochMs: Long): String {
        if (epochMs <= 0L) return ""
        val diff = (System.currentTimeMillis() - epochMs).coerceAtLeast(0L) / 1000L
        return when {
            diff < 10 -> "たった今"
            diff < 60 -> "${diff}秒前"
            diff < 3600 -> "${diff / 60}分前"
            diff < 86_400 -> "${diff / 3600}時間前"
            else -> "${diff / 86_400}日前"
        }
    }

    fun contextText(fraction: Double): String {
        if (fraction <= 0.0) return "—"
        val pct = fraction * 100.0
        return if (pct < 1.0) String.format(Locale.US, "%.1f%%", pct)
        else "${pct.toInt()}%"
    }

    fun pairFromUri(text: String): Pair<String, String>? {
        val trimmed = text.trim()
        if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed to ""
        val uri = runCatching { Uri.parse(trimmed) }.getOrNull() ?: return null
        if (uri.scheme !in listOf("agentremote", "agentremote-android")) return null
        val url = uri.getQueryParameter("url").orEmpty()
        val token = uri.getQueryParameter("token").orEmpty()
        if (url.isBlank() && token.isBlank()) return null
        return url to token
    }
}

fun buildTimeline(events: List<AgentEvent>): List<TimelineItem> {
    val items = mutableListOf<TimelineItem>()
    for (event in events) {
        when (event.type) {
            "user_message" -> {
                items += TimelineItem(
                    id = "user-${event.seq}",
                    kind = TimelineKind.User,
                    text = event.text.orEmpty(),
                )
            }
            "assistant_delta" -> {
                val last = items.lastOrNull()
                if (last != null && last.kind == TimelineKind.Assistant && last.streaming) {
                    items[items.lastIndex] = last.copy(text = last.text + event.text.orEmpty(), streaming = true)
                } else {
                    items += TimelineItem(
                        id = "assistant-${event.seq}",
                        kind = TimelineKind.Assistant,
                        text = event.text.orEmpty(),
                        streaming = true,
                    )
                }
            }
            "thought_delta" -> {
                val last = items.lastOrNull()
                if (last != null && last.kind == TimelineKind.Thought && last.streaming) {
                    items[items.lastIndex] = last.copy(text = last.text + event.text.orEmpty(), streaming = true)
                } else {
                    items += TimelineItem(
                        id = "thought-${event.seq}",
                        kind = TimelineKind.Thought,
                        text = event.text.orEmpty(),
                        streaming = true,
                    )
                }
            }
            "tool_call", "tool_update" -> {
                val id = event.toolCallId ?: "tool-${event.seq}"
                val index = items.indexOfFirst { it.kind == TimelineKind.Tool && it.toolCallId == id }
                if (index >= 0) {
                    val current = items[index]
                    items[index] = current.copy(
                        title = event.title ?: current.title,
                        command = event.command ?: current.command,
                        cwd = event.cwd ?: current.cwd,
                        status = event.status ?: current.status,
                        output = event.output ?: current.output,
                    )
                } else {
                    items += TimelineItem(
                        id = "tool-$id",
                        kind = TimelineKind.Tool,
                        toolCallId = id,
                        title = event.title ?: "tool",
                        command = event.command,
                        cwd = event.cwd,
                        status = event.status ?: "in_progress",
                        output = event.output,
                    )
                }
            }
            "turn_end" -> items.replaceAll { if (it.streaming) it.copy(streaming = false) else it }
            "notice" -> items += TimelineItem(
                id = "notice-${event.seq}",
                kind = TimelineKind.Notice,
                text = event.text.orEmpty(),
            )
            "error" -> items += TimelineItem(
                id = "error-${event.seq}",
                kind = TimelineKind.Error,
                text = event.message.orEmpty().ifBlank { "エラーが発生しました" },
            )
        }
    }
    return items
}
