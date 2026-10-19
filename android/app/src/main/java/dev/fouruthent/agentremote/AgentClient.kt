package dev.fouruthent.agentremote

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

class AgentClient(private val listener: Listener) {
    interface Listener {
        fun onOpen()
        fun onMessage(text: String)
        fun onClosed(reason: String)
        fun onFailure(error: String)
    }

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var socket: WebSocket? = null

    fun connect(rawUrl: String) {
        close()
        val url = normalize(rawUrl)
        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                listener.onOpen()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                listener.onMessage(text)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                listener.onClosed(reason.ifBlank { "切断されました ($code)" })
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                listener.onFailure(t.message ?: "接続に失敗しました")
            }
        })
    }

    fun send(json: String): Boolean = socket?.send(json) == true

    fun close() {
        socket?.close(1000, "client closed")
        socket = null
    }

    private fun normalize(input: String): String {
        var value = input.trim()
        if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
            value = if (value.startsWith("http://")) "ws://${value.removePrefix("http://")}"
            else if (value.startsWith("https://")) "wss://${value.removePrefix("https://")}"
            else "ws://$value"
        }
        val path = value.substringAfter("://", "").substringAfter("/", "")
        if (path.isBlank()) value = value.trimEnd('/') + "/ws"
        return value
    }
}
