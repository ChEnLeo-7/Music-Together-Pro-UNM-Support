import { getServerTime, isCalibrated } from '@/lib/clockSync'
import { PLAYER_PLAY_DEDUP_MS } from '@/lib/constants'
import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/SocketProvider'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import type { ScheduledPlayState, Track } from '@music-together/shared'
import { EVENTS } from '@music-together/shared'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { useHowl } from './useHowl'
import { useLyric } from './useLyric'
import { useMediaSession } from './useMediaSession'
import { usePlayerSync } from './usePlayerSync'
import { configureNativePlayback, getNativePlaybackBridge } from '@/lib/nativePlayback'
import { SERVER_URL } from '@/lib/config'
import { projectPlaybackPosition } from '@/lib/playbackPosition'

/**
 * Composing hook: useHowl + useLyric + usePlayerSync.
 * Provides unified playback controls.
 *
 * Architecture: **Scheduled Execution**.
 * All player actions (play, pause, seek, resume) are emitted to the server
 * which broadcasts a `ScheduledPlayState` to ALL clients (including the
 * initiator). Clients then execute the action at the scheduled server-time
 * so that every device acts in unison.
 */
export function usePlayer() {
  const { socket } = useSocketContext()
  const t = useI18n((s) => s.t)
  const room = useRoomStore((s) => s.room)
  const loadingRef = useRef<{ trackId: string; ts: number; serverTimestamp: number } | null>(null)
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preparedRef = useRef<{
    trackId: string
    playbackRevision: number
    audio: HTMLAudioElement
  } | null>(null)

  const next = useCallback(() => socket.emit(EVENTS.PLAYER_NEXT), [socket])

  // Auto-next on song end: only the current conductor (hostId) emits PLAYER_NEXT.
  // The conductor is auto-elected by the server (owner > admin > member).
  // Other clients silently wait to prevent duplicate PLAYER_NEXT events.
  const autoNext = useCallback(() => {
    const { room } = useRoomStore.getState()
    const myId = storage.getUserId()
    if (room?.hostId === myId) {
      socket.emit(EVENTS.PLAYER_NEXT, {
        reason: 'ended',
        trackId: room.currentTrack?.id,
        playbackRevision: room.playState.playbackRevision,
      })
    }
  }, [socket])

  const recoverFromLoadFailure = useCallback(
    (track: Track) => {
      if (track.streamQuality !== 'netease_dolby') return false
      const retryTrack: Track = {
        ...track,
        streamUrl: undefined,
        streamSource: undefined,
        streamQuality: undefined,
        availableStreamQualities: undefined,
      }
      toast.warning(t('dolbyUnavailable'))
      socket.emit(EVENTS.PLAYER_PLAY, {
        track: retryTrack,
        audioQuality: 999,
        sourcePriority: 'platform-only',
      })
      return true
    },
    [socket, t],
  )

  const { howlRef, soundIdRef, loadTrack, localSeek } = useHowl(autoNext, recoverFromLoadFailure)
  const { fetchLyric } = useLyric()

  // Android's Native PlaybackService owns playback synchronization. The
  // WebView remains a UI/control surface on that platform.
  usePlayerSync(howlRef, soundIdRef, !getNativePlaybackBridge())

  useEffect(() => {
    if (!room || !getNativePlaybackBridge()) return
    const rejoinToken = storage.getRejoinToken(room.id) ?? undefined
    if (room.hasPassword && !rejoinToken) return
    configureNativePlayback({
      roomId: room.id,
      userId: storage.getUserId(),
      nickname: storage.getNickname(),
      rejoinToken,
    })
  }, [room])

  // Reset dedup ref on disconnect so reconnect PLAYER_PLAY is never blocked
  useEffect(() => {
    const onDisconnect = () => {
      loadingRef.current = null
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
      if (pendingSeekTimerRef.current) {
        clearTimeout(pendingSeekTimerRef.current)
        pendingSeekTimerRef.current = null
      }
      usePlayerStore.getState().setPendingSeekTarget(null)
    }
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('disconnect', onDisconnect)
    }
  }, [socket])

  // Listen for PLAYER_PLAY events (new track load)
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onPlayerPrepare = (data: { track: Track; playbackRevision: number }) => {
      if (getNativePlaybackBridge()) return
      preparedRef.current?.audio.removeAttribute('src')
      const audio = new Audio()
      audio.preload = 'auto'
      audio.src = data.track.streamUrl?.startsWith('/') ? `${SERVER_URL}${data.track.streamUrl}` : (data.track.streamUrl ?? '')
      preparedRef.current = { trackId: data.track.id, playbackRevision: data.playbackRevision, audio }
      fetchLyric(data.track)

      const started = Date.now()
      const reportReady = () => {
        if (preparedRef.current?.playbackRevision !== data.playbackRevision) return
        if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || Date.now() - started >= 1_000) {
          socket.emit(EVENTS.PLAYER_READY, {
            trackId: data.track.id,
            playbackRevision: data.playbackRevision,
          })
          return
        }
        setTimeout(reportReady, 50)
      }
      audio.load()
      setTimeout(reportReady, 50)
    }

    const onPlayerPlay = (data: { track: Track; playState: ScheduledPlayState; recovery?: boolean }) => {
      const currentRevision = useRoomStore.getState().room?.playState.playbackRevision ?? -1
      if (data.playState.playbackRevision < currentRevision) return

      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
      // Deduplicate: ignore if the same track with the same serverTimestamp
      // was requested within the dedup window.  Comparing serverTimestamp
      // ensures that a legitimate replay of the same track (e.g. loop mode)
      // with a different serverTimestamp is not discarded.
      const now = Date.now()
      if (
        loadingRef.current?.trackId === data.track.id &&
        loadingRef.current.serverTimestamp === data.playState.serverTimestamp &&
        now - loadingRef.current.ts < PLAYER_PLAY_DEDUP_MS
      ) {
        return
      }
      loadingRef.current = { trackId: data.track.id, ts: now, serverTimestamp: data.playState.serverTimestamp }

      // Keep roomStore in sync so recovery effect sees the correct currentTrack
      useRoomStore.getState().updateRoom({
        currentTrack: data.track,
        playState: {
          isPlaying: data.playState.isPlaying,
          currentTime: data.playState.currentTime,
          serverTimestamp: data.playState.serverTimestamp,
          playbackRevision: data.playState.playbackRevision,
        },
      })

      const ct = data.playState.currentTime
      if (data.recovery) {
        const anchor = {
          currentTime: ct,
          serverTimestamp: data.playState.serverTimestamp,
          isPlaying: data.playState.isPlaying,
          duration: data.track.duration,
        }
        loadTrack(
          data.track,
          projectPlaybackPosition(anchor, getServerTime()),
          data.playState.isPlaying,
          anchor,
        )
        fetchLyric(data.track)
        return
      }
      const executeDelay = Math.max(
        0,
        data.playState.serverTimeToExecute - (isCalibrated() ? getServerTime() : Date.now()),
      )

      if (ct > 0 && data.playState.isPlaying && executeDelay > 0) {
        if (playTimerRef.current) clearTimeout(playTimerRef.current)
        playTimerRef.current = setTimeout(() => {
          playTimerRef.current = null
          loadTrack(data.track, ct, data.playState.isPlaying)
          fetchLyric(data.track)
        }, executeDelay)
        return
      }

      if (ct === 0 && data.playState.serverTimeToExecute) {
        // New track from position 0: schedule load so playback begins at
        // the coordinated server-time.  We load with autoPlay=true and let
        // the scheduling delay account for buffering.
        // When NTP is not yet calibrated, execute immediately (delay=0) to
        // avoid wildly inaccurate scheduling from uncorrected local clocks.
        const delay = isCalibrated() ? Math.max(0, data.playState.serverTimeToExecute - getServerTime()) : 0
        if (playTimerRef.current) clearTimeout(playTimerRef.current)
        playTimerRef.current = setTimeout(() => {
          playTimerRef.current = null
          preparedRef.current?.audio.removeAttribute('src')
          preparedRef.current = null
          loadTrack(data.track, 0, data.playState.isPlaying)
          fetchLyric(data.track)
        }, delay)
      } else {
        // Mid-song join or currentTime > 0: load immediately and seek to
        // the expected position at the scheduled execution time.
        const elapsed = data.playState.isPlaying
          ? Math.max(0, (getServerTime() - data.playState.serverTimestamp) / 1000)
          : 0
        const adjustedTime = ct + elapsed

        loadTrack(data.track, adjustedTime, data.playState.isPlaying)
        fetchLyric(data.track)
      }
    }

    const cancelPendingPlay = () => {
      if (!playTimerRef.current) return
      clearTimeout(playTimerRef.current)
      playTimerRef.current = null
    }

    const onPlayerSeek = (data: { playState: ScheduledPlayState }) => {
      cancelPendingPlay()
      if (!getNativePlaybackBridge()) return
      const playerState = usePlayerStore.getState()
      if (
        playerState.pendingSeekTarget !== null &&
        Math.abs(playerState.pendingSeekTarget - data.playState.currentTime) < 0.05
      ) {
        playerState.setPendingSeekRevision(data.playState.playbackRevision)
      }
      useRoomStore.getState().updateRoom({
        playState: {
          isPlaying: data.playState.isPlaying,
          currentTime: data.playState.currentTime,
          serverTimestamp: data.playState.serverTimestamp,
          playbackRevision: data.playState.playbackRevision,
        },
      })
    }

    socket.on(EVENTS.PLAYER_PLAY, onPlayerPlay)
    socket.on(EVENTS.PLAYER_PREPARE, onPlayerPrepare)
    socket.on(EVENTS.PLAYER_PAUSE, cancelPendingPlay)
    socket.on(EVENTS.PLAYER_SEEK, onPlayerSeek)

    return () => {
      socket.off(EVENTS.PLAYER_PLAY, onPlayerPlay)
      socket.off(EVENTS.PLAYER_PREPARE, onPlayerPrepare)
      socket.off(EVENTS.PLAYER_PAUSE, cancelPendingPlay)
      socket.off(EVENTS.PLAYER_SEEK, onPlayerSeek)
      if (playTimerRef.current) {
        clearTimeout(playTimerRef.current)
        playTimerRef.current = null
      }
    }
  }, [socket, loadTrack, fetchLyric])

  // Recovery: auto-sync player state from room state when desync is detected
  // (e.g. after HMR resets stores, or reconnection where PLAYER_PLAY was missed)
  useEffect(() => {
    let recoveredRevision = -1

    const recover = () => {
      const { room } = useRoomStore.getState()

      // When room becomes null (disconnect), reset flag so next reconnect can recover
      if (!room) {
        recoveredRevision = -1
        if (recoveryTimerRef.current) {
          clearTimeout(recoveryTimerRef.current)
          recoveryTimerRef.current = null
        }
        return
      }

      const loadedTrack = usePlayerStore.getState().loadedTrack
      const roomTrack = room.currentTrack
      const engineMatchesRoom = !!howlRef.current && loadedTrack?.id === roomTrack?.id

      // Server has cleared the track (queue empty / cleared) — reset client
      if (!roomTrack && (loadedTrack || howlRef.current)) {
        recoveredRevision = room.playState.playbackRevision
        if (recoveryTimerRef.current) {
          clearTimeout(recoveryTimerRef.current)
          recoveryTimerRef.current = null
        }
        if (howlRef.current) {
          try {
            howlRef.current.unload()
          } catch {
            /* ignore */
          }
          howlRef.current = null
        }
        soundIdRef.current = undefined
        usePlayerStore.getState().reset()
        return
      }

      if (recoveredRevision === room.playState.playbackRevision) return

      // Room metadata is authoritative and can restore lyrics immediately.
      // Audio recovery additionally requires a resolved stream URL.
      if (roomTrack && !engineMatchesRoom) {
        void fetchLyric(roomTrack)
        if (!roomTrack.streamUrl) return

        // Skip if onPlayerPlay is already handling this track — its updateRoom()
        // call triggers this subscription synchronously before loadTrack runs,
        // so playerTrack/howlRef are still stale. Checking loadingRef avoids
        // a redundant double-load.
        if (loadingRef.current?.trackId === roomTrack.id || recoveryTimerRef.current) return

        // ROOM_STATE is sent immediately before the scheduled PLAYER_PLAY on
        // join/reconnect. Wait for that event so recovery cannot start early.
        recoveryTimerRef.current = setTimeout(() => {
          recoveryTimerRef.current = null
          const latestRoom = useRoomStore.getState().room
          if (!latestRoom?.currentTrack?.streamUrl) return
          const latestLoadedTrack = usePlayerStore.getState().loadedTrack
          if (howlRef.current && latestLoadedTrack?.id === latestRoom.currentTrack.id) return

          if (howlRef.current) {
            try {
              howlRef.current.unload()
            } catch {
              /* ignore */
            }
            howlRef.current = null
            soundIdRef.current = undefined
          }
          const ps = latestRoom.playState
          recoveredRevision = ps.playbackRevision
          loadingRef.current = {
            trackId: latestRoom.currentTrack.id,
            ts: Date.now(),
            serverTimestamp: ps.serverTimestamp,
          }
          const anchor = {
            currentTime: ps.currentTime,
            serverTimestamp: ps.serverTimestamp,
            isPlaying: ps.isPlaying,
            duration: latestRoom.currentTrack.duration,
          }
          loadTrack(
            latestRoom.currentTrack,
            projectPlaybackPosition(anchor, getServerTime()),
            ps.isPlaying,
            anchor,
          )
          fetchLyric(latestRoom.currentTrack)
        }, 1_500)
      }
    }

    // Check immediately (covers HMR where roomStore already has data)
    recover()

    // Subscribe for future changes (covers reconnect where ROOM_STATE arrives later)
    const unsubscribe = useRoomStore.subscribe(recover)
    return () => {
      unsubscribe()
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
    }
    // `socket` intentionally excluded — effect subscribes to roomStore, not socket directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTrack, fetchLyric])

  // -----------------------------------------------------------------------
  // Controls — emit to server only.  Server broadcasts ScheduledPlayState
  // to ALL clients (including us) via scheduled execution.
  // -----------------------------------------------------------------------
  const play = useCallback(() => {
    socket.emit(EVENTS.PLAYER_PLAY)
  }, [socket])

  const pause = useCallback(() => {
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current)
      playTimerRef.current = null
    }
    socket.emit(EVENTS.PLAYER_PAUSE)
  }, [socket])

  const seek = useCallback(
    (time: number) => {
      if (playTimerRef.current) {
        clearTimeout(playTimerRef.current)
        playTimerRef.current = null
      }
      // Optimistic local update for the progress bar UI
      if (!getNativePlaybackBridge()) localSeek(time)
      const playerState = usePlayerStore.getState()
      if (getNativePlaybackBridge()) playerState.setPendingSeekTarget(time)
      playerState.setCurrentTime(time)
      socket.emit(EVENTS.PLAYER_SEEK, { currentTime: time })
      if (getNativePlaybackBridge()) {
        if (pendingSeekTimerRef.current) clearTimeout(pendingSeekTimerRef.current)
        pendingSeekTimerRef.current = setTimeout(() => {
          pendingSeekTimerRef.current = null
          const latest = usePlayerStore.getState()
          if (latest.pendingSeekTarget === time) latest.setPendingSeekTarget(null)
        }, 6_000)
      }
    },
    [localSeek, socket],
  )

  const prev = useCallback(() => socket.emit(EVENTS.PLAYER_PREV), [socket])

  // MediaSession: hardware media keys + OS media notification bar.
  // Permission-aware: mirrors PlayerControls fallback-to-vote behaviour.
  useMediaSession({ play, pause, next, prev, seek })

  return { play, pause, seek, next, prev }
}
