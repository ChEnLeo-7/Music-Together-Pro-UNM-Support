package app.musictogether.android

internal object ServerUrlMemory {
  fun preferred(initialUrl: String?, legacyUrl: String?): String? =
    initialUrl?.trim()?.takeIf { it.isNotBlank() } ?: legacyUrl?.trim()?.takeIf { it.isNotBlank() }
}
