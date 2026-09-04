import com.aerovista.rydesync.sync.*

fun main() {
    val state = SharedPlayback("track-1", "playing", 1000, 10_000, 3)
    check(PlaybackSync.targetMs(state, 12_500) == 3500L)
    check(PlaybackSync.correction(1000, 1100, "playing") is Correction.None)
    check(PlaybackSync.correction(1000, 1600, "playing") is Correction.Rate)
    check(PlaybackSync.correction(1000, 3000, "playing") is Correction.Seek)
    println("RydeSync Android sync core: OK")
}
