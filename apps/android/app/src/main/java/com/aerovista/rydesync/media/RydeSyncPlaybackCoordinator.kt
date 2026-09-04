package com.aerovista.rydesync.media

import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import com.aerovista.rydesync.sync.Correction
import com.aerovista.rydesync.sync.PlaybackSync
import com.aerovista.rydesync.sync.SharedPlayback

class RydeSyncPlaybackCoordinator(
    private val player: Player,
    private val baseUrl: String,
    private val serverNow: () -> Long,
) {
    private var trackId: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private val resetRate = Runnable { player.setPlaybackSpeed(1f) }

    fun apply(state: SharedPlayback) {
        handler.removeCallbacks(resetRate)
        if (state.trackId == null) {
            player.stop()
            player.clearMediaItems()
            player.setPlaybackSpeed(1f)
            trackId = null
            return
        }
        val target = PlaybackSync.targetMs(state, serverNow())
        if (trackId != state.trackId) {
            trackId = state.trackId
            val uri = "${baseUrl.trimEnd('/')}/v1/echoverse/audio/${java.net.URLEncoder.encode(state.trackId, "UTF-8")}"
            player.setMediaItem(MediaItem.fromUri(uri))
            player.prepare()
            player.seekTo(target)
            player.setPlaybackSpeed(1f)
        } else {
            when (val correction = PlaybackSync.correction(player.currentPosition, target, state.status)) {
                is Correction.Seek -> {
                    player.seekTo(correction.positionMs)
                    player.setPlaybackSpeed(1f)
                }
                is Correction.Rate -> {
                    player.setPlaybackSpeed(correction.rate)
                    handler.postDelayed(resetRate, 3_500)
                }
                Correction.None -> player.setPlaybackSpeed(1f)
            }
        }
        if (state.status == "playing") player.play() else player.pause()
    }
}
