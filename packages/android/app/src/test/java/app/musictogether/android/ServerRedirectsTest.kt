package app.musictogether.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.net.URI

class ServerRedirectsTest {
  @Test
  fun normalizesServerInputAndRejectsUnsupportedUrls() {
    assertEquals(URI("http://music.local:3001"), ServerRedirects.normalize("music.local:3001/"))
    assertEquals(URI("https://music.example"), ServerRedirects.normalize("https://music.example/"))
    assertNull(ServerRedirects.normalize("javascript:alert(1)"))
    assertNull(ServerRedirects.normalize("https://user:pass@music.example"))
  }

  @Test
  fun followsMultiHopAbsoluteAndRelativeRedirects() {
    val responses = mapOf(
      URI("http://music.example/start") to RedirectResponse(301, "https://music.example/app/"),
      URI("https://music.example/app/") to RedirectResponse(302, "../room/ABC"),
      URI("https://music.example/room/ABC") to RedirectResponse(200, null),
    )

    val result = ServerRedirects.resolve(URI("http://music.example/start")) { responses.getValue(it) }

    assertEquals(true, result.accepted)
    assertEquals(URI("https://music.example/room/ABC"), result.uri)
    assertEquals("https://music.example", ServerRedirects.origin(result.uri))
  }

  @Test
  fun stopsRedirectLoopsAndRejectsNonHttpTargets() {
    val initial = URI("https://music.example")
    assertEquals(false, ServerRedirects.resolve(initial) { RedirectResponse(302, initial.toString()) }.accepted)
    assertEquals(false, ServerRedirects.resolve(initial) { RedirectResponse(302, "intent://other-app") }.accepted)
    assertEquals(false, ServerRedirects.resolve(initial) { RedirectResponse(302, null) }.accepted)
  }

  @Test
  fun rejectsRedirectChainsLongerThanTheSafetyLimit() {
    val responses = (0..10).associate { index ->
      URI("https://music.example/$index") to RedirectResponse(302, "https://music.example/${index + 1}")
    }

    val result = ServerRedirects.resolve(URI("https://music.example/0")) { responses.getValue(it) }

    assertEquals(false, result.accepted)
  }

  @Test
  fun acceptsAChainAtTheSafetyLimit() {
    val responses = (0..9).associate { index ->
      URI("https://music.example/$index") to RedirectResponse(302, "https://music.example/${index + 1}")
    } + (URI("https://music.example/10") to RedirectResponse(200, null))

    val result = ServerRedirects.resolve(URI("https://music.example/0")) { responses.getValue(it) }

    assertEquals(true, result.accepted)
    assertEquals(URI("https://music.example/10"), result.uri)
  }
}
