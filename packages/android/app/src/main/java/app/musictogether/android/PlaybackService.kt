package app.musictogether.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.ForwardingPlayer
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
  val trackId: String = "",
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
  private var roomStateRecovery: Runnable? = null
  private var pendingRevision = 0L
  private var suppressEnded = false
  private var latestPlaybackRevision = 0L
  private var preparedRevision = -1L
  private var ntpPingId = 0L
  private val ntpPings = mutableMapOf<Long, Pair<Long, Long>>()
  private val clockOffsets = ArrayDeque<Long>()
  private var serverAnchorTime = 0L
  private var monotonicAnchorTime = 0L
  private var lastServerTime = 0L
  private var mediaSessionSeekPending = false
  private var smoothedDriftSeconds = 0.0
  private var lastNtpRefreshAt = 0L
  private val syncTicker = object : Runnable {
    override fun run() {
      val config = sessionConfig
      val activeSocket = socket
      if (config != null && activeSocket?.connected() == true) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastNtpRefreshAt >= NTP_REFRESH_INTERVAL_MS) {
          lastNtpRefreshAt = now
          emitNtpPing()
        }
        if (config.isConductor && player.isPlaying) {
          activeSocket.emit(EVENT_PLAYER_SYNC, JSONObject().apply {
            put("currentTime", player.currentPosition / 1000.0)
            put("hostServerTime", serverTime())
            currentTrackId?.let { put("trackId", it) }
            put("playbackRevision", latestPlaybackRevision)
          })
        } else if (!config.isConductor) {
          activeSocket.emit(EVENT_PLAYER_SYNC_REQUEST)
        }
      }
      handler.postDelayed(this, SYNC_INTERVAL_MS)
    }
  }

  private val mediaSessionCallback = object : MediaSession.Callback {
    override fun onPlayerCommandRequest(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      playerCommand: Int,
    ): Int {
      when (playerCommand) {
        Player.COMMAND_PLAY_PAUSE -> {
          emitRoomCommand(if (player.playWhenReady || player.isPlaying) EVENT_PLAYER_PAUSE else EVENT_PLAYER_PLAY)
          return Player.COMMAND_INVALID
        }
        Player.COMMAND_SEEK_TO_NEXT,
        Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
        -> {
          emitRoomCommand(EVENT_PLAYER_NEXT)
          return Player.COMMAND_INVALID
        }
        Player.COMMAND_SEEK_TO_PREVIOUS,
        Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
        -> {
          emitRoomCommand(EVENT_PLAYER_PREV)
          return Player.COMMAND_INVALID
        }
      }
      if (playerCommand == Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM ||
        playerCommand == Player.COMMAND_SEEK_IN_CURRENT_WINDOW ||
        playerCommand == Player.COMMAND_SEEK_BACK ||
        playerCommand == Player.COMMAND_SEEK_FORWARD
      ) {
        mediaSessionSeekPending = true
      }
      return playerCommand
    }

    override fun onPlayerInteractionFinished(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      playerCommands: Player.Commands,
    ) {
      if (!mediaSessionSeekPending) return
      mediaSessionSeekPending = false
      emitRoomSeek(player.currentPosition / 1000.0)
    }
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    player = ExoPlayer.Builder(this).build().also {
      it.addListener(this)
      it.setWakeMode(androidx.media3.common.C.WAKE_MODE_NETWORK)
    }
    val sessionPlayer = object : ForwardingPlayer(player) {
      override fun play() = emitRoomCommand(EVENT_PLAYER_PLAY)
      override fun pause() = emitRoomCommand(EVENT_PLAYER_PAUSE)
      override fun setPlayWhenReady(playWhenReady: Boolean) =
        emitRoomCommand(if (playWhenReady) EVENT_PLAYER_PLAY else EVENT_PLAYER_PAUSE)
      override fun seekTo(positionMs: Long) = emitRoomSeek(positionMs / 1000.0)
      override fun seekBack() = emitRoomSeek((player.currentPosition - player.seekBackIncrement).coerceAtLeast(0) / 1000.0)
      override fun seekForward() = emitRoomSeek((player.currentPosition + player.seekForwardIncrement) / 1000.0)
      override fun seekToNext() = emitRoomCommand(EVENT_PLAYER_NEXT)
      override fun seekToNextMediaItem() = emitRoomCommand(EVENT_PLAYER_NEXT)
      override fun seekToPrevious() = emitRoomCommand(EVENT_PLAYER_PREV)
      override fun seekToPreviousMediaItem() = emitRoomCommand(EVENT_PLAYER_PREV)
    }
    mediaSession = MediaSession.Builder(this, sessionPlayer).build()
    updateSnapshot()
    handler.post(snapshotTicker)
    handler.post(syncTicker)
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
      // Web controls already emit these commands through the browser Socket.IO
      // client. Keep native playback passive here; the service socket applies
      // the server's scheduled action, just like MediaSession controls.
      ACTION_PLAY -> emitRoomCommand(EVENT_PLAYER_PLAY)
      ACTION_PAUSE -> emitRoomCommand(EVENT_PLAYER_PAUSE)
      ACTION_SEEK -> emitRoomSeek(intent.getLongExtra(EXTRA_POSITION, 0) / 1000.0)
      ACTION_VOLUME -> player.volume = intent.getFloatExtra(EXTRA_VOLUME, player.volume).coerceIn(0f, 1f)
      ACTION_RATE -> player.setPlaybackSpeed(intent.getFloatExtra(EXTRA_RATE, 1f).coerceIn(0.5f, 2f))
      ACTION_RELEASE_SOURCE -> releaseSource(intent.getStringExtra(EXTRA_SOURCE).orEmpty())
      ACTION_RELEASE_SESSION -> releaseSession()
    }
    updateSnapshot()
    return START_STICKY
  }

  private fun configure(rawConfig: String, cookie: String) {
    val parsed = SessionConfig.from(rawConfig) ?: return
    if (sessionConfig?.sameConnection(parsed) == true && socket?.connected() == true) return
    pendingPlayback?.let(handler::removeCallbacks)
    pendingPlayback = null
    sessionConfig = parsed
    latestPlaybackRevision = 0
    pendingRevision = 0
    clockOffsets.clear()
    serverAnchorTime = 0
    monotonicAnchorTime = 0
    lastServerTime = 0
    lastNtpRefreshAt = 0
    ntpPings.clear()
    socket?.disconnect()
    socket?.off()

    val options = IO.Options.builder()
      .setForceNew(true)
      .setReconnection(true)
      .setExtraHeaders(if (cookie.isBlank()) emptyMap() else mapOf("Cookie" to listOf(cookie)))
      .build()
    socket = IO.socket(URI.create(parsed.serverUrl), options).apply {
      on(Socket.EVENT_CONNECT) {
        handler.post {
          emitRoomJoin()
          repeat(NTP_SAMPLE_COUNT) { sample ->
            handler.postDelayed({ emitNtpPing() }, sample * NTP_SAMPLE_INTERVAL_MS)
          }
        }
      }
      on(EVENT_NTP_PONG) { args -> handler.post { handleNtpPong(args.firstOrNull() as? JSONObject) } }
      on(EVENT_ROOM_STATE) { args -> handler.post { handleRoomState(args.firstOrNull() as? JSONObject) } }
      on(EVENT_PLAYER_LEASE) { args ->
        handler.post { sessionConfig?.isConductor = (args.firstOrNull() as? JSONObject)?.optBoolean("active") == true }
      }
      on(EVENT_ROOM_DISSOLVED) { handler.post { releaseSession() } }
      on(EVENT_ROOM_REJOIN_TOKEN) { args ->
        handler.post {
          val token = (args.firstOrNull() as? JSONObject)?.optString("token").orEmpty()
          if (token.isNotBlank()) sessionConfig?.rejoinToken = token
        }
      }
      on(EVENT_PLAYER_PLAY) { args -> handler.post { handlePlayerPlay(args.firstOrNull() as? JSONObject) } }
      on(EVENT_PLAYER_PREPARE) { args -> handler.post { handlePlayerPrepare(args.firstOrNull() as? JSONObject) } }
      on(EVENT_PLAYER_PAUSE) { args -> handler.post { handleScheduledState(args.firstOrNull() as? JSONObject, false) } }
      on(EVENT_PLAYER_RESUME) { args -> handler.post { handleScheduledState(args.firstOrNull() as? JSONObject, true) } }
      on(EVENT_PLAYER_SEEK) { args -> handler.post { handleSeek(args.firstOrNull() as? JSONObject) } }
      on(EVENT_PLAYER_SYNC_RESPONSE) { args -> handler.post { handleSyncResponse(args.firstOrNull() as? JSONObject) } }
      connect()
    }
  }

  private fun emitNtpPing() {
    val activeSocket = socket ?: return
    val id = ++ntpPingId
    ntpPings[id] = SystemClock.elapsedRealtime() to System.currentTimeMillis()
    activeSocket.emit(EVENT_NTP_PING, JSONObject().put("clientPingId", id))
  }

  private fun handleNtpPong(payload: JSONObject?) {
    val id = payload?.optLong("clientPingId") ?: return
    val sent = ntpPings.remove(id) ?: return
    val receivedAt = SystemClock.elapsedRealtime()
    val rtt = receivedAt - sent.first
    if (rtt !in 0..MAX_NTP_RTT_MS) return
    val serverResponse = payload.optLong("serverTime")
    val serverReceive = payload.optLong("serverReceiveTime", 0L)
    val serverSend = payload.optLong("serverSendTime", 0L)
    val receivedWallTime = System.currentTimeMillis()
    val offset = if (serverReceive > 0L && serverSend >= serverReceive) {
      ((serverReceive - sent.second) + (serverSend - receivedWallTime)) / 2
    } else {
      serverResponse - (sent.second + rtt / 2)
    }
    clockOffsets.addLast(offset)
    while (clockOffsets.size > NTP_SAMPLE_COUNT) clockOffsets.removeFirst()
    val medianOffset = clockOffsets.sorted()[clockOffsets.size / 2]
    monotonicAnchorTime = receivedAt
    serverAnchorTime = receivedWallTime + medianOffset
  }

  private fun serverTime(): Long {
    val candidate = if (serverAnchorTime == 0L || monotonicAnchorTime == 0L) {
      System.currentTimeMillis()
    } else {
      serverAnchorTime + (SystemClock.elapsedRealtime() - monotonicAnchorTime)
    }
    lastServerTime = maxOf(lastServerTime, candidate)
    return lastServerTime
  }

  private fun emitRoomCommand(event: String) {
    socket?.let { if (it.connected()) it.emit(event) }
  }

  private fun emitRoomSeek(positionSeconds: Double) {
    socket?.let {
      if (it.connected()) it.emit(EVENT_PLAYER_SEEK, JSONObject().put("currentTime", positionSeconds.coerceAtLeast(0.0)))
    }
  }

  private fun Socket.emitRoomJoin() {
    val config = sessionConfig ?: return
    emit(EVENT_ROOM_JOIN, JSONObject().apply {
      put("roomId", config.roomId)
      put("nickname", config.nickname)
      put("playbackCapable", true)
      if (!config.rejoinToken.isNullOrBlank()) put("rejoinToken", config.rejoinToken)
    })
  }

  private fun handleRoomState(room: JSONObject?) {
    val config = sessionConfig ?: return
    if (room == null) return
    val state = room.optJSONObject("playState") ?: JSONObject()
    val revision = state.optLong("playbackRevision", 0L)
    if (!acceptRevision(revision)) return
    val track = room.optJSONObject("currentTrack")
    if (track != null && state.optBoolean("isPlaying") && state.optLong("serverTimeToExecute", 0L) == 0L) {
      // Join sends ROOM_STATE before its scheduled PLAYER_PLAY. Defer this
      // recovery so it cannot start a track before the coordinated event.
      roomStateRecovery?.let(handler::removeCallbacks)
      roomStateRecovery = Runnable {
        roomStateRecovery = null
        val latest = sessionConfig ?: return@Runnable
        if (latestPlaybackRevision != revision || currentTrackId == track.optString("id")) return@Runnable
        val elapsed = ((serverTime() - state.optLong("serverTimestamp")) / 1000.0).coerceAtLeast(0.0)
        loadTrack(track, state.optDouble("currentTime", 0.0) + elapsed, true)
      }.also { handler.postDelayed(it, ROOM_STATE_RECOVERY_DELAY_MS) }
      return
    }
    val executeAt = state.optLong("serverTimeToExecute", state.optLong("serverTimestamp", serverTime()))
    scheduleAt(executeAt, revision) {
      val elapsed = if (state.optBoolean("isPlaying")) {
        ((serverTime() - state.optLong("serverTimestamp")) / 1000.0).coerceAtLeast(0.0)
      } else 0.0
      val position = state.optDouble("currentTime", 0.0) + elapsed
      if (track == null) {
        player.pause()
        player.clearMediaItems()
        currentSource = null
        currentTrackId = null
      } else if (track.optString("id") == currentTrackId) {
        if (kotlin.math.abs(player.currentPosition / 1000.0 - position) > ROOM_STATE_DRIFT_SECONDS) {
          seekLocally(position)
        }
        if (state.optBoolean("isPlaying")) player.play() else player.pause()
      } else {
        loadTrack(track, position, state.optBoolean("isPlaying"))
      }
    }
  }

  private fun handlePlayerPlay(payload: JSONObject?) {
    val track = payload?.optJSONObject("track") ?: return
    val state = payload.optJSONObject("playState") ?: JSONObject()
    val revision = state.optLong("playbackRevision", 0L)
    if (!acceptRevision(revision)) return
    roomStateRecovery?.let(handler::removeCallbacks)
    roomStateRecovery = null
    val executeAt = state.optLong("serverTimeToExecute", serverTime())
    scheduleAt(executeAt, revision) {
      val elapsed = ((serverTime() - state.optLong("serverTimestamp")) / 1000.0).coerceAtLeast(0.0)
      val position = state.optDouble("currentTime") + if (state.optBoolean("isPlaying")) elapsed else 0.0
      loadTrack(track, position, state.optBoolean("isPlaying"))
      preparedRevision = -1L
    }
  }

  private fun handlePlayerPrepare(payload: JSONObject?) {
    val track = payload?.optJSONObject("track") ?: return
    val revision = payload.optLong("playbackRevision", 0L)
    if (!acceptRevision(revision)) return
    preparedRevision = revision
    roomStateRecovery?.let(handler::removeCallbacks)
    roomStateRecovery = null
    loadTrack(track, 0.0, false)
  }

  private fun handleScheduledState(payload: JSONObject?, shouldPlay: Boolean) {
    val state = payload?.optJSONObject("playState") ?: return
    val revision = state.optLong("playbackRevision", 0L)
    if (!acceptRevision(revision)) return
    val executeAt = state.optLong("serverTimeToExecute", serverTime())
    scheduleAt(executeAt, revision) {
      seekLocally(state.optDouble("currentTime"))
      if (shouldPlay) player.play() else player.pause()
    }
  }

  private fun handleSeek(payload: JSONObject?) {
    val state = payload?.optJSONObject("playState") ?: return
    val revision = state.optLong("playbackRevision", 0L)
    if (!acceptRevision(revision)) return
    val executeAt = state.optLong("serverTimeToExecute", serverTime())
    scheduleAt(executeAt, revision) {
      seekLocally(state.optDouble("currentTime"))
    }
  }

  private fun handleSyncResponse(payload: JSONObject?) {
    val config = sessionConfig ?: return
    if (config.isConductor || payload == null || !player.isPlaying) return
    val revision = payload.optLong("playbackRevision", 0L)
    if (revision != latestPlaybackRevision) return
    val responseTrackId = payload.optString("trackId").takeIf(String::isNotBlank)
    if (responseTrackId != null && responseTrackId != currentTrackId) return

    val serverIsPlaying = payload.optBoolean("isPlaying")
    if (!serverIsPlaying) {
      seekLocally(payload.optDouble("currentTime", 0.0))
      player.pause()
      player.setPlaybackSpeed(1f)
      smoothedDriftSeconds = 0.0
      return
    }
    val expected = payload.optDouble("currentTime", 0.0) + if (serverIsPlaying) {
      ((serverTime() - payload.optLong("serverTimestamp")) / 1000.0).coerceIn(0.0, MAX_SYNC_NETWORK_DELAY_S)
    } else 0.0
    val drift = player.currentPosition / 1000.0 - expected
    smoothedDriftSeconds = DRIFT_SMOOTH_ALPHA * drift + (1 - DRIFT_SMOOTH_ALPHA) * smoothedDriftSeconds
    val absoluteDrift = kotlin.math.abs(smoothedDriftSeconds)
    if (absoluteDrift >= DRIFT_HARD_SEEK_SECONDS) {
      seekLocally(expected)
      player.setPlaybackSpeed(1f)
      smoothedDriftSeconds = 0.0
    } else if (absoluteDrift >= DRIFT_DEAD_ZONE_SECONDS) {
      player.setPlaybackSpeed((1f - (smoothedDriftSeconds * DRIFT_RATE_KP)).coerceIn(1f - MAX_RATE_ADJUSTMENT, 1f + MAX_RATE_ADJUSTMENT))
    } else {
      player.setPlaybackSpeed(1f)
    }
  }

  private fun acceptRevision(revision: Long): Boolean {
    if (revision < latestPlaybackRevision) return false
    latestPlaybackRevision = revision
    return true
  }

  private fun scheduleAt(serverTimeToExecute: Long, revision: Long, action: () -> Unit) {
    if (revision < latestPlaybackRevision) return
    pendingPlayback?.let(handler::removeCallbacks)
    pendingRevision = revision
    pendingPlayback = Runnable {
      pendingPlayback = null
      if (revision != latestPlaybackRevision || pendingRevision != revision) return@Runnable
      val remaining = serverTimeToExecute - serverTime()
      if (remaining > 0) {
        scheduleAt(serverTimeToExecute, revision, action)
        return@Runnable
      }
      action()
    }.also { handler.postDelayed(it, (serverTimeToExecute - serverTime()).coerceAtLeast(0L)) }
  }

  private fun seekLocally(positionSeconds: Double) {
    player.seekTo((positionSeconds * 1000).toLong().coerceAtLeast(0))
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

  private fun releaseSession() {
    pendingPlayback?.let(handler::removeCallbacks)
    pendingPlayback = null
    roomStateRecovery?.let(handler::removeCallbacks)
    roomStateRecovery = null
    socket?.emit(EVENT_ROOM_LEAVE)
    socket?.disconnect()
    socket?.off()
    socket = null
    sessionConfig = null
    currentSource = null
    currentTrackId = null
    ntpPings.clear()
    clockOffsets.clear()
    serverAnchorTime = 0
    monotonicAnchorTime = 0
    lastServerTime = 0
    smoothedDriftSeconds = 0.0
    player.stop()
    player.clearMediaItems()
    stopForeground(STOP_FOREGROUND_REMOVE)
    updateSnapshot()
    stopSelf()
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
      Player.STATE_READY -> {
        sendPlaybackEvent("load", duration = player.duration.coerceAtLeast(0))
        if (preparedRevision == latestPlaybackRevision && currentTrackId != null) {
          socket?.emit(EVENT_PLAYER_READY, JSONObject().apply {
            put("trackId", currentTrackId)
            put("playbackRevision", preparedRevision)
          })
        }
      }
      Player.STATE_ENDED -> if (!suppressEnded) {
        sendPlaybackEvent("end")
        if (sessionConfig?.isConductor == true) {
          socket?.emit(EVENT_PLAYER_NEXT, JSONObject().apply {
            put("reason", "ended")
            currentTrackId?.let { put("trackId", it) }
            put("playbackRevision", latestPlaybackRevision)
          })
        }
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
      put("trackId", currentTrackId)
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
      trackId = currentTrackId.orEmpty(),
    )
  }

  override fun onDestroy() {
    handler.removeCallbacks(snapshotTicker)
    handler.removeCallbacks(syncTicker)
    pendingPlayback?.let(handler::removeCallbacks)
    roomStateRecovery?.let(handler::removeCallbacks)
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
    fun sameConnection(other: SessionConfig): Boolean =
      serverUrl == other.serverUrl && roomId == other.roomId && userId == other.userId

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
    const val ACTION_RELEASE_SESSION = "app.musictogether.RELEASE_SESSION"
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
    const val EVENT_PLAYER_PREPARE = "player:prepare"
    const val EVENT_PLAYER_READY = "player:ready"
    const val EVENT_PLAYER_LEASE = "player:lease"
    const val EVENT_PLAYER_PAUSE = "player:pause"
    const val EVENT_PLAYER_RESUME = "player:resume"
    const val EVENT_PLAYER_SEEK = "player:seek"
    const val EVENT_PLAYER_NEXT = "player:next"
    const val EVENT_PLAYER_PREV = "player:prev"
    const val EVENT_PLAYER_SYNC = "player:sync"
    const val EVENT_PLAYER_SYNC_REQUEST = "player:sync_request"
    const val EVENT_PLAYER_SYNC_RESPONSE = "player:sync_response"
    const val EVENT_ROOM_LEAVE = "room:leave"
    const val EVENT_ROOM_DISSOLVED = "room:dissolved"
    const val EVENT_NTP_PING = "ntp:ping"
    const val EVENT_NTP_PONG = "ntp:pong"

    const val NOTIFICATION_CHANNEL_ID = "music-together-playback"
    const val NOTIFICATION_ID = 1001
    private const val SNAPSHOT_INTERVAL_MS = 100L
    private const val NTP_SAMPLE_COUNT = 7
    private const val NTP_SAMPLE_INTERVAL_MS = 50L
    private const val NTP_REFRESH_INTERVAL_MS = 30_000L
    private const val SYNC_INTERVAL_MS = 2_000L
    private const val MAX_NTP_RTT_MS = 10_000L
    private const val ROOM_STATE_DRIFT_SECONDS = 0.5
    private const val ROOM_STATE_RECOVERY_DELAY_MS = 1_500L
    private const val DRIFT_DEAD_ZONE_SECONDS = 0.03
    private const val DRIFT_HARD_SEEK_SECONDS = 0.2
    private const val DRIFT_RATE_KP = 0.25
    private const val MAX_RATE_ADJUSTMENT = 0.02f
    private const val MAX_SYNC_NETWORK_DELAY_S = 5.0

    @Volatile var snapshot = PlaybackSnapshot()
  }
}

private fun JSONArray.joinStrings(): String = buildList {
  for (index in 0 until length()) add(optString(index))
}.filter(String::isNotBlank).joinToString(" / ")
