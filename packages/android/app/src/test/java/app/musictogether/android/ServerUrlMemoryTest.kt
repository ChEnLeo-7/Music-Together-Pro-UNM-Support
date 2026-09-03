package app.musictogether.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerUrlMemoryTest {
  @Test
  fun prefersTheInitialUrlOverTheLegacyValue() {
    assertEquals(
      "https://music.example/start",
      ServerUrlMemory.preferred("https://music.example/start", "https://redirected.example"),
    )
  }

  @Test
  fun fallsBackToLegacyValueWhenTheInitialValueIsBlank() {
    assertEquals(
      "https://redirected.example",
      ServerUrlMemory.preferred("  ", "https://redirected.example"),
    )
  }

  @Test
  fun trimsTheSelectedValue() {
    assertEquals("https://music.example", ServerUrlMemory.preferred(" https://music.example ", null))
  }

  @Test
  fun returnsNullWhenNeitherValueIsUsable() {
    assertNull(ServerUrlMemory.preferred(null, ""))
  }
}
