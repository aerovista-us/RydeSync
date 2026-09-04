package com.aerovista.rydesync.realtime

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

class RydeSyncRealtimeClient(
    private val baseUrl: String,
    private val client: OkHttpClient = OkHttpClient(),
    private val onMessage: (JSONObject) -> Unit,
    private val onClosed: (Int, String) -> Unit = { _, _ -> },
) {
    private var socket: WebSocket? = null
    private var roomId: String? = null
    private var roomToken: String? = null
    private var lastSeq: Long = 0

    fun connect(roomId: String, roomToken: String) {
        this.roomId = roomId
        this.roomToken = roomToken
        val wsBase = baseUrl.trimEnd('/').replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
        val request = Request.Builder().url("$wsBase/v1/realtime?room=${java.net.URLEncoder.encode(roomId, "UTF-8")}").build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(JSONObject().put("type", "auth").put("token", roomToken).put("lastSeenSeq", lastSeq).toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val json = runCatching { JSONObject(text) }.getOrNull() ?: return
                if (json.has("seq")) lastSeq = maxOf(lastSeq, json.optLong("seq", 0))
                onMessage(json)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = onClosed(code, reason)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = onClosed(response?.code ?: -1, t.message ?: "websocket failure")
        })
    }

    fun send(json: JSONObject): Boolean = socket?.send(json.toString()) ?: false
    fun close() { socket?.close(1000, "leaving ride"); socket = null }
}
