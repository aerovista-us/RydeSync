package com.aerovista.rydesync.auth

/**
 * AV Identity remains an adapter boundary. The eventual Firebase/Identity Gateway
 * implementation should keep a current short-lived token cached for Media3 while
 * refreshBearerToken() performs any asynchronous renewal outside media reads.
 */
interface AvIdentityTokenProvider {
    fun currentBearerToken(): String?
    suspend fun refreshBearerToken(): String? = currentBearerToken()
}

class NoopAvIdentityTokenProvider : AvIdentityTokenProvider {
    override fun currentBearerToken(): String? = null
}
