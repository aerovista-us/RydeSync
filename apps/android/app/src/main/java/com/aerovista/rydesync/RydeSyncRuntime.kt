package com.aerovista.rydesync

import com.aerovista.rydesync.auth.AvIdentityTokenProvider
import com.aerovista.rydesync.auth.NoopAvIdentityTokenProvider

object RydeSyncRuntime {
    @Volatile var baseUrl: String = "https://rydesync.aerovista.us"
    @Volatile var identity: AvIdentityTokenProvider = NoopAvIdentityTokenProvider()
}
