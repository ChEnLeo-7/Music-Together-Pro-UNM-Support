package app.musictogether.android

import java.net.URI

internal data class RedirectResponse(val statusCode: Int, val location: String?)
internal data class RedirectResolution(val uri: URI, val accepted: Boolean)

internal object ServerRedirects {
  private const val MAX_REDIRECTS = 10

  fun normalize(raw: String): URI? {
    val value = raw.trim().trimEnd('/')
    if (value.isBlank()) return null
    val withScheme = if ("://" in value) value else "http://$value"
    val uri = runCatching { URI(withScheme) }.getOrNull() ?: return null
    return uri.takeIf { it.isHttpOrHttps() && it.userInfo == null }
  }

  fun resolve(initial: URI, request: (URI) -> RedirectResponse): RedirectResolution {
    var current = initial
    val visited = mutableSetOf(current.normalize())
    var redirectCount = 0

    while (true) {
      val response = request(current)
      if (!isRedirectStatus(response.statusCode)) return RedirectResolution(current, true)
      if (response.location.isNullOrBlank()) return RedirectResolution(current, false)
      if (redirectCount >= MAX_REDIRECTS) return RedirectResolution(current, false)
      val next = runCatching { current.resolve(response.location).normalize() }.getOrNull()
        ?: return RedirectResolution(current, false)
      if (!next.isHttpOrHttps() || next.userInfo != null || !visited.add(next)) return RedirectResolution(current, false)
      current = next
      redirectCount += 1
    }
  }

  fun origin(uri: URI): String = buildString {
    append(uri.scheme.lowercase())
    append("://")
    append(uri.host)
    val port = effectivePort(uri)
    val defaultPort = if (uri.scheme.equals("https", ignoreCase = true)) 443 else 80
    if (port != defaultPort) append(":$port")
  }

  private fun URI.isHttpOrHttps(): Boolean =
    (scheme.equals("http", ignoreCase = true) || scheme.equals("https", ignoreCase = true)) && !host.isNullOrBlank()

  private fun isRedirectStatus(statusCode: Int): Boolean = statusCode in setOf(300, 301, 302, 303, 307, 308)

  private fun effectivePort(uri: URI): Int = when {
    uri.port >= 0 -> uri.port
    uri.scheme.equals("https", ignoreCase = true) -> 443
    else -> 80
  }
}
