package app.musictogether.android

import kotlin.math.abs

internal data class SyncCorrection(
  val seekToSeconds: Double? = null,
  val playbackRate: Float = 1f,
  val nextSmoothedDriftSeconds: Double = 0.0,
)

internal object PlaybackSyncMath {
  fun expectedPosition(
    currentTimeSeconds: Double,
    serverTimestampMs: Long,
    serverNowMs: Long,
    isPlaying: Boolean,
    maxNetworkDelaySeconds: Double,
  ): Double = currentTimeSeconds + if (isPlaying) {
    ((serverNowMs - serverTimestampMs) / 1000.0).coerceIn(0.0, maxNetworkDelaySeconds)
  } else {
    0.0
  }

  fun correction(
    actualSeconds: Double,
    expectedSeconds: Double,
    previousSmoothedDriftSeconds: Double,
    smoothingAlpha: Double,
    deadZoneSeconds: Double,
    hardSeekSeconds: Double,
    rateKp: Double,
    maxRateAdjustment: Double,
  ): SyncCorrection {
    val drift = actualSeconds - expectedSeconds
    val smoothed = smoothingAlpha * drift + (1 - smoothingAlpha) * previousSmoothedDriftSeconds
    val absoluteDrift = abs(smoothed)
    return when {
      absoluteDrift >= hardSeekSeconds -> SyncCorrection(seekToSeconds = expectedSeconds)
      absoluteDrift >= deadZoneSeconds -> SyncCorrection(
        playbackRate = (1.0 - smoothed * rateKp)
          .coerceIn(1.0 - maxRateAdjustment, 1.0 + maxRateAdjustment)
          .toFloat(),
        nextSmoothedDriftSeconds = smoothed,
      )
      else -> SyncCorrection()
    }
  }
}
