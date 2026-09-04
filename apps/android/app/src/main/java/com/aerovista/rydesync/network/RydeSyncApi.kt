package com.aerovista.rydesync.network

import com.aerovista.rydesync.auth.AvIdentityTokenProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class RydeSyncApi(
    private val baseUrl: String,
    private val identity: AvIdentityTokenProvider,
    private val client: OkHttpClient = OkHttpClient(),
) {
    suspend fun session(): JSONObject = get("/v1/session", authenticated = true)
    suspend fun catalog(): JSONObject = get("/v1/echoverse/catalog", authenticated = true)

    suspend fun createRoom(name: String, mode: String = "group_ride"): JSONObject =
        post("/v1/rooms", JSONObject().put("name", name).put("mode", mode), authenticated = true)

    suspend fun joinRoom(room: String, displayName: String): JSONObject =
        post("/v1/rooms/${room.encodePath()}/join", JSONObject().put("displayName", displayName), authenticated = true)

    private suspend fun get(path: String, authenticated: Boolean): JSONObject = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(baseUrl.trimEnd('/') + path), authenticated)
    }

    private suspend fun post(path: String, body: JSONObject, authenticated: Boolean): JSONObject = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(baseUrl.trimEnd('/') + path)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
        execute(request, authenticated)
    }

    private suspend fun execute(builder: Request.Builder, authenticated: Boolean): JSONObject {
        if (authenticated) identity.refreshBearerToken()?.let { builder.header("Authorization", "Bearer $it") }
        client.newCall(builder.header("Accept", "application/json").build()).execute().use { response ->
            val text = response.body.string()
            if (!response.isSuccessful) error("RydeSync HTTP ${response.code}: $text")
            return JSONObject(text)
        }
    }

    private fun String.encodePath(): String = java.net.URLEncoder.encode(this, Charsets.UTF_8.name()).replace("+", "%20")
}
