package app.musictogether.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackSyncMathTest {
  @Test
  fun `expected position adds bounded calibrated network delay`() {
    assertEquals(12.5, PlaybackSyncMath.expectedPosition(10.0, 1_000, 3_500, true, 5.0), 0.0001)
    assertEquals(15.0, PlaybackSyncMath.expectedPosition(10.0, 1_000, 20_000, true, 5.0), 0.0001)
    assertEquals(10.0, PlaybackSyncMath.expectedPosition(10.0, 1_000, 20_000, false, 5.0), 0.0001)
  }

  @Test
  fun `small drift stays at normal speed`() {
    val result = correction(actual = 10.01, expected = 10.0)
    assertNull(result.seekToSeconds)
    assertEquals(1f, result.playbackRate)
  }

  @Test
  fun `moderate drift adjusts speed within cap`() {
    val ahead = correction(actual = 10.1, expected = 10.0, alpha = 1.0)
    assertNull(ahead.seekToSeconds)
    assertEquals(0.98f, ahead.playbackRate)

    val behind = correction(actual = 9.9, expected = 10.0, alpha = 1.0)
    assertEquals(1.02f, behind.playbackRate)
  }

  @Test
  fun `large drift hard seeks and resets smoothing`() {
    val result = correction(actual = 11.0, expected = 10.0, alpha = 1.0)
    assertEquals(10.0, result.seekToSeconds!!, 0.0001)
    assertEquals(0.0, result.nextSmoothedDriftSeconds, 0.0001)
  }

  private fun correction(actual: Double, expected: Double, alpha: Double = 0.2) = PlaybackSyncMath.correction(
    actualSeconds = actual,
    expectedSeconds = expected,
    previousSmoothedDriftSeconds = 0.0,
    smoothingAlpha = alpha,
    deadZoneSeconds = 0.03,
    hardSeekSeconds = 0.2,
    rateKp = 0.25,
    maxRateAdjustment = 0.02,
  )
}
