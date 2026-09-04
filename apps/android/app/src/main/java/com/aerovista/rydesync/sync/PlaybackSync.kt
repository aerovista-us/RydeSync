package com.aerovista.rydesync.sync

import kotlin.math.abs
import kotlin.math.max

data class SharedPlayback(
    val trackId: String?,
    val status: String,
    val positionMs: Long,
    val anchorServerMs: Long,
    val epoch: Long,
)

sealed interface Correction {
    data object None : Correction
    data class Seek(val positionMs: Long) : Correction
    data class Rate(val rate: Float, val driftMs: Long) : Correction
}

object PlaybackSync {
    fun targetMs(state: SharedPlayback, serverNowMs: Long): Long {
        if (state.trackId == null) return 0
        if (state.status != "playing") return max(0, state.positionMs)
        return max(0, state.positionMs + max(0, serverNowMs - state.anchorServerMs))
    }

    fun correction(currentMs: Long, targetMs: Long, status: String, softDriftMs: Long = 250, hardDriftMs: Long = 1500): Correction {
        val drift = targetMs - currentMs
        val magnitude = abs(drift)
        if (status != "playing") return if (magnitude >= softDriftMs) Correction.Seek(max(0, targetMs)) else Correction.None
        if (magnitude >= hardDriftMs) return Correction.Seek(max(0, targetMs))
        if (magnitude >= softDriftMs) return Correction.Rate(if (drift > 0) 1.03f else 0.97f, drift)
        return Correction.None
    }
}
