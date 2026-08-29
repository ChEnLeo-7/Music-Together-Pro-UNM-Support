package app.musictogether.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.core.app.NotificationCompat
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

data class PlaybackSnapshot(
  val positionMs: Long = 0,
  val durationMs: Long = 0,
  val isPlaying: Boolean = false,
  val volume: Float = 0.8f,
  val rate: Float = 1f,
)

class PlaybackService : MediaSessionService(), Player.Listener {
  private lateinit var player: ExoPlayer
  private lateinit var mediaSession: MediaSession
  private val handler = Handler(Looper.getMainLooper())
  private val snapshotTicker = object : Runnable {
    override fun run() {
      updateSnapshot()
      handler.postDelayed(this, SNAPSHOT_INTERVAL_MS)
    }
  }
  private var socket: Socket? = null
  private var sessionConfig: SessionConfig? = null
  private var currentSource: String? = null
  private var currentTrackId: String? = null
  private var pendingPlayback: Runnable? = null
  private var suppressEnded = false

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    player = ExoPlayer.Builder(this).build().also {
      it.addListener(this)
      it.setWakeMode(androidx.media3.common.C.WAKE_MODE_NETWORK)
    }
    mediaSession = MediaSession.Builder(this, player).build()
    updateSnapshot()
    handler.post(snapshotTicker)
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession = mediaSession

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_CONFIGURE -> configure(
        intent.getStringExtra(EXTRA_CONFIG).orEmpty(),
        intent.getStringExtra(EXTRA_COOKIE).orEmpty(),
      )
      ACTION_LOAD -> load(
        intent.getStringExtra(EXTRA_SOURCE).orEmpty(),
        intent.getStringExtra(EXTRA_MIME_TYPE).orEmpty(),
        intent.getStringExtra(EXTRA_METADATA).orEmpty(),
      )
      ACTION_PLAY -> player.play()
      ACTION_PAUSE -> player.pause()
      ACTION_SEEK -> player.seekTo(intent.getLongExtra(EXTRA_POSITION, 0))
      ACTION_VOLUME -> player.volume = intent.getFloatExtra(EXTRA_VOLUME, player.volume).coerceIn(0f, 1f)
      ACTION_RATE -> player.setPlaybackSpeed(intent.getFloatExtra(EXTRA_RATE, 1f).coerceIn(0.5f, 2f))
      ACTION_RELEASE_SOURCE -> releaseSource(intent.getStringExtra(EXTRA_SOURCE).orEmpty())
    }
    updateSnapshot()
    return START_STICKY
  }

  private fun configure(rawConfig: String, cookie: String) {
    val parsed = SessionConfig.from(rawConfig) ?: return
    if (sessionConfig == parsed && socket?.connected() == true) return
    sessionConfig = parsed
    socket?.disconnect()
    socket?.off()

    val options = IO.Options.builder()
      .setForceNew(true)
      .setReconnection(true)
      .setExtraHeaders(if (cookie.isBlank()) emptyMap() else mapOf("Cookie" to listOf(cookie)))
      .build()
    socket = IO.socket(URI.create(parsed.serverUrl), options).apply {
      on(Socket.EVENT_CONNECT) { emitRoomJoin() }
      on(EVENT_ROOM_STATE) { args -> handleRoomState(args.firstOrNull() as? JSONObject) }
      on(EVENT_ROOM_REJOIN_TOKEN) { args ->
        val token = (args.firstOrNull() as? JSONObject)?.optString("token").orEmpty()
        if (token.isNotBlank()) sessionConfig?.rejoinToken = token
      }
      on(EVENT_PLAYER_PLAY) { args -> handlePlayerPlay(args.firstOrNull() as? JSONObject) }
      on(EVENT_PLAYER_PAUSE) { args -> handleScheduledState(args.firstOrNull() as? JSONObject, false) }
      on(EVENT_PLAYER_RESUME) { args -> handleScheduledState(args.firstOrNull() as? JSONObject, true) }
      on(EVENT_PLAYER_SEEK) { args -> handleSeek(args.firstOrNull() as? JSONObject) }
      connect()
    }
  }

  private fun Socket.emitRoomJoin() {
    val config = sessionConfig ?: return
    emit(EVENT_ROOM_JOIN, JSONObject().apply {
      put("roomId", config.roomId)
      put("nickname", config.nickname)
      if (!config.rejoinToken.isNullOrBlank()) put("rejoinToken", config.rejoinToken)
    })
  }

  private fun handleRoomState(room: JSONObject?) {
    val config = sessionConfig ?: return
    if (room == null) return
    val hostId = room.optString("hostId")
    config.isConductor = hostId == config.userId
    val track = room.optJSONObject("currentTrack") ?: return
    val state = room.optJSONObject("playState") ?: JSONObject()
    if (track.optString("id") == currentTrackId) return
    val elapsed = if (state.optBoolean("isPlaying")) {
      ((System.currentTimeMillis() - state.optLong("serverTimestamp")) / 1000.0).coerceAtLeast(0.0)
    } else 0.0
    loadTrack(track, state.optDouble("currentTime") + elapsed, state.optBoolean("isPlaying"))
  }

  private fun handlePlayerPlay(payload: JSONObject?) {
    val track = payload?.optJSONObject("track") ?: return
    val state = payload.optJSONObject("playState") ?: JSONObject()
    val delay = (state.optLong("serverTimeToExecute") - System.currentTimeMillis()).coerceAtLeast(0)
    schedule(delay) {
      val elapsed = ((System.currentTimeMillis() - state.optLong("serverTimestamp")) / 1000.0).coerceAtLeast(0.0)
      val position = state.optDouble("currentTime") + if (state.optBoolean("isPlaying")) elapsed else 0.0
      loadTrack(track, position, state.optBoolean("isPlaying"))
    }
  }

  private fun handleScheduledState(payload: JSONObject?, shouldPlay: Boolean) {
    val state = payload?.optJSONObject("playState") ?: return
    val delay = (state.optLong("serverTimeToExecute") - System.currentTimeMillis()).coerceAtLeast(0)
    schedule(delay) {
      player.seekTo((state.optDouble("currentTime") * 1000).toLong().coerceAtLeast(0))
      if (shouldPlay) player.play() else player.pause()
    }
  }

  private fun handleSeek(payload: JSONObject?) {
    val state = payload?.optJSONObject("playState") ?: return
    val delay = (state.optLong("serverTimeToExecute") - System.currentTimeMillis()).coerceAtLeast(0)
    schedule(delay) {
      player.seekTo((state.optDouble("currentTime") * 1000).toLong().coerceAtLeast(0))
    }
  }

  private fun schedule(delayMs: Long, action: () -> Unit) {
    pendingPlayback?.let(handler::removeCallbacks)
    pendingPlayback = Runnable {
      pendingPlayback = null
      action()
    }.also { handler.postDelayed(it, delayMs) }
  }

  private fun loadTrack(track: JSONObject, positionSeconds: Double, autoPlay: Boolean) {
    val source = resolveSource(track.optString("streamUrl"))
    if (source.isBlank()) return
    currentTrackId = track.optString("id")
    load(source, "", track.toString(), positionSeconds, autoPlay)
  }

  private fun resolveSource(source: String): String {
    if (source.startsWith("http://") || source.startsWith("https://")) return source
    val base = sessionConfig?.serverUrl?.trimEnd('/') ?: return source
    return "$base/${source.trimStart('/')}"
  }

  private fun load(
    source: String,
    mimeType: String,
    rawMetadata: String,
    positionSeconds: Double = 0.0,
    autoPlay: Boolean = true,
  ) {
    if (source.isBlank()) return
    if (source == currentSource) {
      if (positionSeconds > 0) player.seekTo((positionSeconds * 1000).toLong())
      if (autoPlay) player.play()
      return
    }

    val metadata = parseMetadata(rawMetadata)
    startForeground(NOTIFICATION_ID, buildNotification(metadata.mediaMetadata))
    val item = MediaItem.Builder()
      .setUri(source)
      .setMimeType(normalizeMimeType(mimeType))
      .setMediaId(metadata.id.ifBlank { source })
      .setMediaMetadata(metadata.mediaMetadata)
      .build()
    suppressEnded = true
    currentSource = source
    if (metadata.id.isNotBlank()) currentTrackId = metadata.id
    player.setMediaItem(item, (positionSeconds * 1000).toLong().coerceAtLeast(0))
    player.prepare()
    player.playWhenReady = autoPlay
    suppressEnded = false
  }

  private fun releaseSource(source: String) {
    // WebView may unload a stale wrapper after the service has already received
    // the next track over its own socket. Never release the newer native source.
    if (source.isNotBlank() && source != currentSource) return
  }

  private fun normalizeMimeType(value: String): String? = when {
    value.contains("ec-3", ignoreCase = true) -> MimeTypes.AUDIO_E_AC3
    value.isBlank() -> null
    else -> value.substringBefore(';')
  }

  private fun parseMetadata(raw: String): ParsedMetadata {
    val json = runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
    val artwork = json.optString("cover").takeIf(String::isNotBlank)?.let(Uri::parse)
    return ParsedMetadata(
      id = json.optString("id"),
      mediaMetadata = MediaMetadata.Builder()
        .setTitle(json.optString("title"))
        .setArtist(json.optString("artist", json.optJSONArray("artist")?.joinStrings().orEmpty()))
        .setAlbumTitle(json.optString("album"))
        .setArtworkUri(artwork)
        .build(),
    )
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      NOTIFICATION_CHANNEL_ID,
      getString(R.string.playback_channel_name),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.playback_channel_description)
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun buildNotification(metadata: MediaMetadata) = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
    .setSmallIcon(R.drawable.ic_notification)
    .setContentTitle(metadata.title ?: getString(R.string.playback_notification_title))
    .setContentText(metadata.artist ?: getString(R.string.playback_notification_connecting))
    .setContentIntent(PendingIntent.getActivity(
      this,
      0,
      packageManager.getLaunchIntentForPackage(packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    ))
    .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
    .setOnlyAlertOnce(true)
    .setOngoing(true)
    .build()

  override fun onPlaybackStateChanged(playbackState: Int) {
    updateSnapshot()
    when (playbackState) {
      Player.STATE_READY -> sendPlaybackEvent("load", duration = player.duration.coerceAtLeast(0))
      Player.STATE_ENDED -> if (!suppressEnded) {
        sendPlaybackEvent("end")
        if (sessionConfig?.isConductor == true) socket?.emit(EVENT_PLAYER_NEXT)
      }
    }
  }

  override fun onIsPlayingChanged(isPlaying: Boolean) {
    updateSnapshot()
    if (isPlaying) {
      sendPlaybackEvent("play")
    } else if (!player.playWhenReady) {
      // Buffering, seeking, and replacing a MediaItem temporarily make
      // isPlaying false without changing the user's play intent.
      sendPlaybackEvent("pause")
    }
  }

  override fun onPlayerError(error: PlaybackException) {
    updateSnapshot()
    sendPlaybackEvent("error", message = error.message)
  }

  private fun sendPlaybackEvent(type: String, duration: Long? = null, message: String? = null) {
    val payload = JSONObject().apply {
      put("type", type)
      put("source", currentSource)
      duration?.let { put("duration", it / 1000.0) }
      message?.let { put("message", it) }
    }
    sendBroadcast(Intent(ACTION_PLAYBACK_EVENT).setPackage(packageName).putExtra(EXTRA_EVENT, payload.toString()))
  }

  private fun updateSnapshot() {
    snapshot = PlaybackSnapshot(
      positionMs = player.currentPosition.coerceAtLeast(0),
      durationMs = player.duration.coerceAtLeast(0),
      isPlaying = player.isPlaying,
      volume = player.volume,
      rate = player.playbackParameters.speed,
    )
  }

  override fun onDestroy() {
    handler.removeCallbacks(snapshotTicker)
    pendingPlayback?.let(handler::removeCallbacks)
    socket?.disconnect()
    socket?.off()
    mediaSession.release()
    player.release()
    super.onDestroy()
  }

  private data class ParsedMetadata(val id: String, val mediaMetadata: MediaMetadata)

  private data class SessionConfig(
    val serverUrl: String,
    val roomId: String,
    val userId: String,
    val nickname: String,
    var rejoinToken: String?,
    var isConductor: Boolean = false,
  ) {
    companion object {
      fun from(raw: String): SessionConfig? = runCatching {
        val json = JSONObject(raw)
        SessionConfig(
          serverUrl = json.getString("serverUrl"),
          roomId = json.getString("roomId"),
          userId = json.getString("userId"),
          nickname = json.getString("nickname"),
          rejoinToken = json.optString("rejoinToken").takeIf(String::isNotBlank),
        )
      }.getOrNull()
    }
  }

  companion object {
    const val ACTION_CONFIGURE = "app.musictogether.CONFIGURE"
    const val ACTION_LOAD = "app.musictogether.LOAD"
    const val ACTION_PLAY = "app.musictogether.PLAY"
    const val ACTION_PAUSE = "app.musictogether.PAUSE"
    const val ACTION_SEEK = "app.musictogether.SEEK"
    const val ACTION_VOLUME = "app.musictogether.VOLUME"
    const val ACTION_RATE = "app.musictogether.RATE"
    const val ACTION_RELEASE_SOURCE = "app.musictogether.RELEASE_SOURCE"
    const val ACTION_PLAYBACK_EVENT = "app.musictogether.PLAYBACK_EVENT"

    const val EXTRA_CONFIG = "config"
    const val EXTRA_COOKIE = "cookie"
    const val EXTRA_SOURCE = "source"
    const val EXTRA_MIME_TYPE = "mimeType"
    const val EXTRA_METADATA = "metadata"
    const val EXTRA_POSITION = "position"
    const val EXTRA_VOLUME = "volume"
    const val EXTRA_RATE = "rate"
    const val EXTRA_EVENT = "event"

    const val EVENT_ROOM_JOIN = "room:join"
    const val EVENT_ROOM_STATE = "room:state"
    const val EVENT_ROOM_REJOIN_TOKEN = "room:rejoin_token"
    const val EVENT_PLAYER_PLAY = "player:play"
    const val EVENT_PLAYER_PAUSE = "player:pause"
    const val EVENT_PLAYER_RESUME = "player:resume"
    const val EVENT_PLAYER_SEEK = "player:seek"
    const val EVENT_PLAYER_NEXT = "player:next"

    const val NOTIFICATION_CHANNEL_ID = "music-together-playback"
    const val NOTIFICATION_ID = 1001
    private const val SNAPSHOT_INTERVAL_MS = 100L

    @Volatile var snapshot = PlaybackSnapshot()
  }
}

private fun JSONArray.joinStrings(): String = buildList {
  for (index in 0 until length()) add(optString(index))
}.filter(String::isNotBlank).joinToString(" / ")
