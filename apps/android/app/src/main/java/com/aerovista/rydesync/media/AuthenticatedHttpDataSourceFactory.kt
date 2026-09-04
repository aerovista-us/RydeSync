package com.aerovista.rydesync.media

import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import com.aerovista.rydesync.auth.AvIdentityTokenProvider

class AuthenticatedHttpDataSourceFactory(
    private val identity: AvIdentityTokenProvider,
) : DataSource.Factory {
    override fun createDataSource(): DataSource {
        val source = DefaultHttpDataSource.Factory().createDataSource()
        identity.currentBearerToken()?.let { source.setRequestProperty("Authorization", "Bearer $it") }
        return source
    }
}
