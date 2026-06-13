import type { AudioQuality, MusicSource, PlayMode, PlayState, ScheduledPlayState, SourcePriority, StreamSource, Track } from '@music-together/shared'
import { EVENTS, ERROR_CODE, NTP } from '@music-together/shared'
import { roomRepo } from '../repositories/roomRepository.js'
import { nanoid } from 'nanoid'
import { musicProvider } from './musicProvider.js'
import * as queueService from './queueService.js'
import * as trackFallbackService from './trackFallbackService.js'
import * as authService from './authService.js'
import { estimateCurrentTime } from './syncService.js'
import { broadcastRoomList } from './roomLifecycleService.js'
import { toPublicRoomState } from '../utils/roomUtils.js'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import type { RoomData } from '../repositories/types.js'
import type { TypedServer, TypedSocket } from '../middleware/types.js'

// ---------------------------------------------------------------------------
// Per-room mutex for playTrackInRoom (prevents concurrent execution)
// ---------------------------------------------------------------------------

const playMutexes = new Map<string, Promise<unknown>>()

// ---------------------------------------------------------------------------
// Auto fallback cooldown (prevents repeated attempts / ping-pong)
// ---------------------------------------------------------------------------

const autoFallbackCooldown = new Map<string, number>()

function canAutoFallback(roomId: string, trackId: string): boolean {
  const key = `${roomId}:${trackId}`
  const until = autoFallbackCooldown.get(key)
  if (!until) return true
  if (Date.now() >= until) {
    autoFallbackCooldown.delete(key)
    return true
  }
  return false
}

function markAutoFallback(roomId: string, trackId: string, ms: number): void {
  const key = `${roomId}:${trackId}`
  autoFallbackCooldown.set(key, Date.now() + ms)
}

function withPlayMutex<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const prev = playMutexes.get(roomId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  playMutexes.set(roomId, next)
  // Cleanup entry when chain settles to avoid unbounded growth
  next.finally(() => {
    if (playMutexes.get(roomId) === next) playMutexes.delete(roomId)
  })
  return next
}

// ---------------------------------------------------------------------------
// Scheduled execution helpers
// ---------------------------------------------------------------------------

/**
 * Compute the future server-time at which all clients should execute an
 * action, based on the P90 RTT in the room.
 */
function getScheduleTime(roomId: string): number {
  const maxRTT = roomRepo.getP90RTT(roomId)
  const delay = Math.min(Math.max(maxRTT * 1.5 + 100, NTP.MIN_SCHEDULE_DELAY_MS), NTP.MAX_SCHEDULE_DELAY_MS)
  return Date.now() + delay
}

/** Build a ScheduledPlayState from a plain PlayState.
 *  Accepts an optional pre-computed scheduleTime to keep room state and
 *  broadcast payload consistent (same timestamp for both). */
function scheduled(ps: PlayState, roomId: string, scheduleTime?: number): ScheduledPlayState {
  return { ...ps, serverTimeToExecute: scheduleTime ?? getScheduleTime(roomId) }
}

// ---------------------------------------------------------------------------
// Audio quality fallback
// ---------------------------------------------------------------------------

/** Ordered fallback bitrates for each quality tier */
type BitrateQuality = 128 | 192 | 320 | 999

const BITRATE_FALLBACKS: Record<BitrateQuality, BitrateQuality[]> = {
  999: [320, 192, 128],
  320: [192, 128],
  192: [128],
  128: [],
}

const QUALITY_DEGRADE_ORDER: AudioQuality[] = [
  'netease_master',
  'netease_spatial',
  'netease_dolby',
  'netease_jyeffect',
  'netease_hires',
  'kugou_master',
  'kugou_hires',
  'tencent_master',
  'tencent_flac',
  999,
  320,
  192,
  128,
]

const UNM_AVAILABLE_QUALITIES: AudioQuality[] = [128, 192, 320, 999]
const NETEASE_AVAILABLE_QUALITY_FALLBACK: AudioQuality[] = [
  'netease_master',
  'netease_spatial',
  'netease_dolby',
  'netease_jyeffect',
  'netease_hires',
  999,
  320,
  192,
  128,
]

function qualityToBitrate(quality: AudioQuality): BitrateQuality {
  return typeof quality === 'number' ? quality : 999
}

function normalizeSourcePriority(sourcePriority: SourcePriority): SourcePriority {
  return sourcePriority
}

function getPlatformRequestQuality(sourcePriority: SourcePriority, requestedQuality: AudioQuality, hasVipCookie: boolean): AudioQuality {
  if (sourcePriority === 'unm-only') return 320
  if (sourcePriority !== 'smart' && sourcePriority !== 'unm-first') return requestedQuality
  if (hasVipCookie) return requestedQuality
  return 320
}

function rankQuality(quality: AudioQuality): number {
  const index = QUALITY_DEGRADE_ORDER.indexOf(quality)
  return index === -1 ? QUALITY_DEGRADE_ORDER.length : index
}

function getFallbackQualities(requestedQuality: AudioQuality, availableQualities?: AudioQuality[]): AudioQuality[] {
  const available = availableQualities?.length ? [...availableQualities] : [...QUALITY_DEGRADE_ORDER]
  const requestedRank = rankQuality(requestedQuality)
  return available
    .filter((quality) => rankQuality(quality) >= requestedRank)
      .sort((a, b) => rankQuality(a) - rankQuality(b))
}

function getNeteaseFallbackQualities(requestedQuality: AudioQuality, availableQualities?: AudioQuality[]): AudioQuality[] {
  return getFallbackQualities(requestedQuality, availableQualities?.length ? availableQualities : NETEASE_AVAILABLE_QUALITY_FALLBACK)
}

function getSupportedPlatformQuality(
  source: MusicSource,
  requestedQuality: AudioQuality,
  hasVipCookie: boolean,
  availableQualities?: AudioQuality[],
  options: { preferRequestedQuality?: boolean } = {},
): AudioQuality {
  if (options.preferRequestedQuality) return requestedQuality
  if (source !== 'netease' || !hasVipCookie) return requestedQuality
  if (availableQualities?.includes(requestedQuality)) return requestedQuality
  return getNeteaseFallbackQualities(requestedQuality, availableQualities)[0] ?? 320
}

interface ResolvedStream {
  url: string
  streamSource: StreamSource
  streamQuality: AudioQuality
  availableStreamQualities?: AudioQuality[]
}

/**
 * Try to get a stream URL at the requested bitrate. If it fails, try each
 * lower tier in order until one succeeds or all options are exhausted.
 */
async function resolveStreamUrl(
  roomId: string,
  source: MusicSource,
  urlId: string,
  bitrate: AudioQuality,
  cookie?: string,
  options: { unmMode?: 'fallback' | 'disabled' | 'only'; preferRequestedQuality?: boolean } = {},
  availableQualities?: AudioQuality[],
): Promise<ResolvedStream | null> {
  const normalizedBitrate = qualityToBitrate(bitrate)
  const fallbackCandidates =
    source === 'netease' && options.unmMode !== 'only'
      ? getNeteaseFallbackQualities(bitrate, availableQualities)
      : [bitrate]
  const candidates =
    options.preferRequestedQuality
      ? [bitrate]
      : fallbackCandidates
  const tried = new Set<string>()

  for (const quality of candidates) {
    const key = String(quality)
    if (tried.has(key)) continue
    tried.add(key)
    const url = await musicProvider.getStreamUrl(source, urlId, quality, cookie, roomId, options)
    if (url) {
      return {
        url: url.url,
        streamSource: url.source,
        streamQuality: url.source === 'unm' && !UNM_AVAILABLE_QUALITIES.includes(quality) ? 999 : url.quality ?? quality,
        availableStreamQualities: url.source === 'unm' ? UNM_AVAILABLE_QUALITIES : availableQualities,
      }
    }
  }

  // Fallback to lower bitrates
  if (options.preferRequestedQuality) {
    return null
  }

  for (const fallback of BITRATE_FALLBACKS[normalizedBitrate]) {
    const key = String(fallback)
    if (tried.has(key)) continue
    tried.add(key)
    const fallbackUrl = await musicProvider.getStreamUrl(source, urlId, fallback, cookie, roomId, options)
    if (fallbackUrl) {
      logger.info(`Bitrate fallback: ${bitrate} -> ${fallback} for ${source}/${urlId}`)
      return {
        url: fallbackUrl.url,
        streamSource: fallbackUrl.source,
        streamQuality: fallback,
        availableStreamQualities: fallbackUrl.source === 'unm' ? UNM_AVAILABLE_QUALITIES : availableQualities,
      }
    }
  }

  return null
}

async function resolveStreamByPolicy(
  roomId: string,
  source: MusicSource,
  urlId: string,
  sourcePriority: SourcePriority,
  requestedQuality: AudioQuality,
  platformQuality: AudioQuality,
  cookie?: string,
  hasVipCookie = false,
  isVipTrack = false,
  availableQualities?: AudioQuality[],
  options: { preferRequestedQuality?: boolean } = {},
): Promise<ResolvedStream | null> {
  const policy = normalizeSourcePriority(sourcePriority)
  const attempts: Array<{ route: 'platform' | 'unm'; quality: AudioQuality; unmMode: 'disabled' | 'only' }> = []

  switch (policy) {
    case 'platform-only':
      attempts.push({ route: 'platform', quality: platformQuality, unmMode: 'disabled' })
      break
    case 'unm-only':
      attempts.push({ route: 'unm', quality: requestedQuality, unmMode: 'only' })
      break
    case 'unm-first':
      attempts.push({ route: 'unm', quality: requestedQuality, unmMode: 'only' })
      attempts.push({ route: 'platform', quality: platformQuality, unmMode: 'disabled' })
      break
    case 'platform-first':
      attempts.push({ route: 'platform', quality: platformQuality, unmMode: 'disabled' })
      attempts.push({ route: 'unm', quality: requestedQuality, unmMode: 'only' })
      break
    case 'smart':
    default:
      if (isVipTrack && !hasVipCookie) {
        attempts.push({ route: 'unm', quality: requestedQuality, unmMode: 'only' })
        attempts.push({ route: 'platform', quality: 320, unmMode: 'disabled' })
      } else {
        attempts.push({ route: 'platform', quality: platformQuality, unmMode: 'disabled' })
        attempts.push({ route: 'unm', quality: requestedQuality, unmMode: 'only' })
      }
      break
  }

  const tried = new Set<string>()
  for (const attempt of attempts) {
    const key = `${attempt.route}:${attempt.quality}:${attempt.unmMode}`
    if (tried.has(key)) continue
    tried.add(key)

    logger.info('Stream resolve attempt', {
      roomId,
      source,
      urlId,
      policy,
      route: attempt.route,
      requestedQuality: String(requestedQuality),
      attemptQuality: String(attempt.quality),
      hasVipCookie,
      isVipTrack,
    })

    const stream = await resolveStreamUrl(
      roomId,
      source,
      urlId,
      attempt.quality,
      cookie,
      { unmMode: attempt.unmMode, preferRequestedQuality: options.preferRequestedQuality && attempt.route === 'platform' },
      attempt.route === 'platform' ? availableQualities : undefined,
    )
    if (stream) {
      logger.info('Stream resolve attempt succeeded', {
        roomId,
        source,
        urlId,
        policy,
        route: stream.streamSource === 'unm' ? 'unm' : 'platform',
        streamSource: stream.streamSource,
        requestedQuality: String(requestedQuality),
        attemptQuality: String(attempt.quality),
        streamQuality: String(stream.streamQuality),
      })
      return stream
    }

    logger.warn('Stream resolve attempt failed', {
      roomId,
      source,
      urlId,
      policy,
      route: attempt.route,
      requestedQuality: String(requestedQuality),
      attemptQuality: String(attempt.quality),
      hasVipCookie,
      isVipTrack,
    })
  }

  return null
}

/**
 * Resolve stream URL / cover, set current track, and broadcast PLAYER_PLAY.
 * Returns true on success, false on failure.
 * Serialized per room via mutex to prevent concurrent state corruption.
 */
interface PlayTrackOptions {
  audioQuality?: AudioQuality
  sourcePriority?: SourcePriority
  forceRefreshStream?: boolean
}

export function playTrackInRoom(io: TypedServer, roomId: string, track: Track, options: PlayTrackOptions = {}): Promise<boolean> {
  return withPlayMutex(roomId, () => _playTrackInRoom(io, roomId, track, options))
}

/**
 * Auto-play when the queue was empty. Re-checks `room.currentTrack` inside
 * the mutex so that concurrent QUEUE_ADD handlers don't both trigger playback
 * (the second caller sees the track set by the first and bails out).
 */
export function autoPlayIfEmpty(io: TypedServer, roomId: string, track: Track): Promise<boolean> {
  return withPlayMutex(roomId, async () => {
    const room = roomRepo.get(roomId)
    if (!room || room.currentTrack) return false
    return _playTrackInRoom(io, roomId, track)
  })
}

async function _playTrackInRoom(io: TypedServer, roomId: string, track: Track, options: PlayTrackOptions = {}): Promise<boolean> {
  const room = roomRepo.get(roomId)
  if (!room) return false

  const resolved = { ...track }
  if (options.forceRefreshStream) {
    delete resolved.streamUrl
    delete resolved.streamSource
    delete resolved.streamQuality
    delete resolved.availableStreamQualities
  }

  // Fetch stream URL if missing
  if (!resolved.streamUrl) {
    try {
      // Get cookie from the room's pool for this platform (enables VIP access)
      const cookie = authService.getAnyCookie(resolved.source, roomId)
      const hasVipCookie = authService.hasVipCookie(resolved.source, roomId)
      const requestedSourcePriority = options.sourcePriority ?? room.sourcePriority
      const requestedAudioQuality = options.audioQuality ?? room.audioQuality
      const preferRequestedPlatformQuality =
        options.forceRefreshStream && options.audioQuality !== undefined && requestedSourcePriority !== 'unm-only'
      const platformAvailableQualities =
        resolved.source === 'netease' && hasVipCookie
          ? await musicProvider.getNeteaseAvailableQualities(resolved.urlId, cookie ?? undefined)
          : undefined
      const platformAudioQuality = getSupportedPlatformQuality(
        resolved.source,
        getPlatformRequestQuality(requestedSourcePriority, requestedAudioQuality, hasVipCookie),
        hasVipCookie,
        platformAvailableQualities,
        { preferRequestedQuality: preferRequestedPlatformQuality },
      )
      let stream = await resolveStreamByPolicy(
        roomId,
        resolved.source,
        resolved.urlId,
        requestedSourcePriority,
        requestedAudioQuality,
        platformAudioQuality,
        cookie ?? undefined,
        hasVipCookie,
        resolved.vip,
        platformAvailableQualities,
        { preferRequestedQuality: preferRequestedPlatformQuality },
      )

      if (!stream) {
        if (options.forceRefreshStream && track.streamUrl) {
          logger.warn('Explicit stream quality switch failed; keeping current stream', {
            roomId,
            trackTitle: resolved.title,
            trackSource: resolved.source,
            urlId: resolved.urlId,
            requestedQuality: String(requestedAudioQuality),
            sourcePriority: requestedSourcePriority,
            hasVipCookie,
          })
          io.to(roomId).emit(EVENTS.ROOM_ERROR, {
            code: ERROR_CODE.STREAM_FAILED,
            message: `无法切换到请求的音质，已保留当前播放：${resolved.title}`,
          })
          return false
        }

        const isVip = resolved.vip
        const hint = isVip && !cookie ? '（VIP 歌曲，需要有用户登录 VIP 账号）' : ''
        logger.warn(`Cannot get stream URL for "${resolved.title}"${hint}, removing from queue`, { roomId })

        // -------------------------------------------------------------------
        // Auto fallback (netease <-> tencent)
        // -------------------------------------------------------------------
        if (
          config.autoFallback.enabled &&
          (resolved.source === 'netease' || resolved.source === 'tencent') &&
          canAutoFallback(roomId, resolved.id)
        ) {
          // Prevent repeated fallback attempts for this queue item
          markAutoFallback(roomId, resolved.id, 60_000)
          const fromSource = resolved.source
          const trackTitle = resolved.title
          const toSource = trackFallbackService.getFallbackTargetSource(fromSource)
          if (toSource) {
            const attemptId = nanoid()
            io.to(roomId).emit(EVENTS.ROOM_AUTO_FALLBACK, {
              attemptId,
              status: 'trying',
              fromSource,
              toSource,
              trackTitle,
              reasonType: isVip && !cookie ? 'VIP_REQUIRED' : 'UNKNOWN',
              reasonDetail: isVip && !cookie ? 'VIP 歌曲未登录' : undefined,
            })

            try {
              const best = await trackFallbackService.findBestAlternativeTrack(resolved, toSource)
              if (best) {
                const cookie2 = authService.getAnyCookie(best.track.source, roomId)
                const fallbackHasVipCookie = authService.hasVipCookie(best.track.source, roomId)
                const fallbackAvailableQualities =
                  best.track.source === 'netease' && fallbackHasVipCookie
                    ? await musicProvider.getNeteaseAvailableQualities(best.track.urlId, cookie2 ?? undefined)
                    : undefined
                const fallbackPlatformQuality = getSupportedPlatformQuality(
                  best.track.source,
                  getPlatformRequestQuality(requestedSourcePriority, requestedAudioQuality, fallbackHasVipCookie),
                  fallbackHasVipCookie,
                  fallbackAvailableQualities,
                  { preferRequestedQuality: preferRequestedPlatformQuality },
                )
                const stream2 = await resolveStreamByPolicy(
                  roomId,
                  best.track.source,
                  best.track.urlId,
                  requestedSourcePriority,
                  requestedAudioQuality,
                  fallbackPlatformQuality,
                  cookie2 ?? undefined,
                  fallbackHasVipCookie,
                  best.track.vip,
                  fallbackAvailableQualities,
                  { preferRequestedQuality: preferRequestedPlatformQuality },
                )
                if (stream2) {
                  const replacement: Track = {
                    ...best.track,
                    id: resolved.id, // keep stable id so queue/current references remain consistent
                    requestedBy: resolved.requestedBy,
                    streamUrl: stream2.url,
                    streamSource: stream2.streamSource,
                    streamQuality: stream2.streamQuality,
                    availableStreamQualities: stream2.availableStreamQualities,
                  }

                  // Replace in queue (if present) before playing
                  const roomBefore = roomRepo.get(roomId)
                  if (roomBefore) {
                    roomBefore.queue = roomBefore.queue.map((t) => (t.id === resolved.id ? replacement : t))
                    io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: roomBefore.queue })
                  }

                  io.to(roomId).emit(EVENTS.ROOM_AUTO_FALLBACK, {
                    attemptId,
                    status: 'success',
                    fromSource,
                    toSource,
                    trackTitle,
                  })

                  // Continue playback with replacement
                  resolved.source = replacement.source
                  resolved.sourceId = replacement.sourceId
                  resolved.urlId = replacement.urlId
                  resolved.lyricId = replacement.lyricId
                  resolved.picId = replacement.picId
                  resolved.vip = replacement.vip
                  resolved.album = replacement.album
                  resolved.artist = replacement.artist
                  resolved.title = replacement.title
                  resolved.cover = replacement.cover
                  resolved.streamUrl = replacement.streamUrl
                  resolved.streamSource = replacement.streamSource
                  resolved.streamQuality = replacement.streamQuality
                  resolved.availableStreamQualities = replacement.availableStreamQualities
                }
              }
            } catch (fallbackErr) {
              logger.error('Auto fallback failed', fallbackErr, { roomId })
            }

            if (!resolved.streamUrl) {
              io.to(roomId).emit(EVENTS.ROOM_AUTO_FALLBACK, {
                attemptId,
                status: 'failed',
                fromSource,
                toSource,
                trackTitle,
                reasonType: isVip && !cookie ? 'VIP_REQUIRED' : 'UNKNOWN',
              })
            }
          }
        }

        // If still no streamUrl, follow original failure path
        if (!resolved.streamUrl) {
          // Auto-remove the invalid track from the queue
          queueService.removeTrack(roomId, resolved.id)
          const room2 = roomRepo.get(roomId)
          if (room2) io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: room2.queue })
          io.to(roomId).emit(EVENTS.ROOM_ERROR, {
            code: ERROR_CODE.STREAM_FAILED,
            message: `无法获取「${resolved.title}」的播放链接${hint}，已从列表移除`,
          })
          return false
        }
      }
      resolved.streamUrl = stream?.url ?? resolved.streamUrl
      resolved.streamSource = stream?.streamSource ?? resolved.streamSource
      resolved.streamQuality = stream?.streamQuality ?? resolved.streamQuality
      resolved.availableStreamQualities = stream?.availableStreamQualities ?? resolved.availableStreamQualities
      logger.info('Track stream resolved', {
        roomId,
        trackTitle: resolved.title,
        trackSource: resolved.source,
        urlId: resolved.urlId,
        route: (resolved.streamSource ?? resolved.source) === 'unm' ? 'unm' : 'platform',
        streamSource: resolved.streamSource ?? resolved.source,
        streamQuality: String(resolved.streamQuality ?? platformAudioQuality),
        requestedQuality: String(requestedAudioQuality),
        platformRequestQuality: String(platformAudioQuality),
        sourcePriority: requestedSourcePriority,
        hasVipCookie,
        availableStreamQualities: resolved.availableStreamQualities?.map(String),
      })
    } catch (err) {
      logger.error(`getStreamUrl failed for ${resolved.urlId}`, err, { roomId })
      // Auto-remove on unexpected failure too
      queueService.removeTrack(roomId, resolved.id)
      const room2 = roomRepo.get(roomId)
      if (room2) io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: room2.queue })
      return false
    }
  }

  // Fetch cover if missing
  if (!resolved.cover && resolved.picId) {
    try {
      const cover = await musicProvider.getCover(resolved.source, resolved.picId)
      if (cover) resolved.cover = cover
    } catch {
      // Non-critical, leave cover empty
    }
  }

  // Update room state — align serverTimestamp with the scheduled execution time
  // so that estimateCurrentTime() is accurate before the first conductor report.
  const previousTrackId = room.currentTrack?.id
  const previousIsPlaying = room.playState.isPlaying
  const resumeTime = options.forceRefreshStream && previousIsPlaying && previousTrackId === track.id ? Math.max(0, estimateCurrentTime(roomId)) : 0
  room.currentTrack = resolved
  const scheduleTime = getScheduleTime(roomId)
  room.playState = {
    isPlaying: true,
    currentTime: resumeTime,
    serverTimestamp: scheduleTime,
  }

  io.to(roomId).emit(EVENTS.PLAYER_PLAY, {
    track: resolved,
    playState: scheduled(room.playState, roomId, scheduleTime),
  })

  // 通知大厅用户当前播放曲目变化
  broadcastRoomList(io)

  logger.info(`Playing: ${resolved.title} in room ${roomId}`, {
    roomId,
    route: (resolved.streamSource ?? resolved.source) === 'unm' ? 'unm' : 'platform',
    streamSource: resolved.streamSource ?? resolved.source,
    streamQuality: resolved.streamQuality ? String(resolved.streamQuality) : undefined,
  })
  return true
}

export function resumeTrack(io: TypedServer, roomId: string, _initiatorSocket?: TypedSocket): void {
  const room = roomRepo.get(roomId)
  if (!room || !room.currentTrack) return

  const scheduleTime = getScheduleTime(roomId)
  room.playState = { ...room.playState, isPlaying: true, serverTimestamp: scheduleTime }
  // All clients (including initiator) must execute at the same scheduled moment
  io.to(roomId).emit(EVENTS.PLAYER_RESUME, { playState: scheduled(room.playState, roomId, scheduleTime) })
}

export function pauseTrack(io: TypedServer, roomId: string, _initiatorSocket?: TypedSocket): void {
  const room = roomRepo.get(roomId)
  if (!room) return

  // Snapshot estimated position before pausing so resume starts from the correct point
  const snapshotTime = estimateCurrentTime(roomId)
  room.playState = { isPlaying: false, currentTime: snapshotTime, serverTimestamp: Date.now() }
  // All clients must pause at the same scheduled moment
  io.to(roomId).emit(EVENTS.PLAYER_PAUSE, { playState: scheduled(room.playState, roomId) })
}

export function seekTrack(io: TypedServer, roomId: string, currentTime: number, _initiatorSocket?: TypedSocket): void {
  const room = roomRepo.get(roomId)
  if (!room) return

  const scheduleTime = getScheduleTime(roomId)
  // When playing, align serverTimestamp with scheduled time so estimateCurrentTime() is accurate
  room.playState = {
    ...room.playState,
    currentTime,
    serverTimestamp: room.playState.isPlaying ? scheduleTime : Date.now(),
  }
  // All clients must seek at the same scheduled moment
  io.to(roomId).emit(EVENTS.PLAYER_SEEK, { playState: scheduled(room.playState, roomId, scheduleTime) })
}

export function updatePlayState(roomId: string, update: Partial<PlayState>): void {
  const room = roomRepo.get(roomId)
  if (room) {
    room.playState = { ...room.playState, ...update, serverTimestamp: Date.now() }
  }
}

export function setCurrentTrack(roomId: string, track: Track | null): void {
  const room = roomRepo.get(roomId)
  if (room) {
    room.currentTrack = track
    room.playState = {
      isPlaying: track !== null,
      currentTime: 0,
      serverTimestamp: Date.now(),
    }
  }
}

/**
 * Stop playback: clear current track, emit PLAYER_PAUSE with a stopped state,
 * broadcast full ROOM_STATE so clients clear stale track, and notify lobby.
 * Used when no next track is available (queue empty, track removed, queue cleared).
 */
export function stopPlayback(io: TypedServer, roomId: string): void {
  setCurrentTrack(roomId, null)
  io.to(roomId).emit(EVENTS.PLAYER_PAUSE, {
    playState: { isPlaying: false, currentTime: 0, serverTimestamp: Date.now(), serverTimeToExecute: Date.now() },
  })
  const room = roomRepo.get(roomId)
  if (room) {
    io.to(roomId).emit(EVENTS.ROOM_STATE, toPublicRoomState(room))
  }
  broadcastRoomList(io)
}

/**
 * Mutex-protected variant of `stopPlayback`. Use when the caller is NOT
 * already inside the per-room mutex (e.g. QUEUE_CLEAR) to prevent races
 * with concurrent `autoPlayIfEmpty` / `_playTrackInRoom` operations.
 */
export function stopPlaybackSafe(io: TypedServer, roomId: string): Promise<void> {
  return withPlayMutex(roomId, async () => {
    stopPlayback(io, roomId)
  })
}

// ---------------------------------------------------------------------------
// Next / Previous track (debounce + queue navigation inside mutex)
// ---------------------------------------------------------------------------

/**
 * Advance to the next track in the queue. Debounce check and queue navigation
 * run inside the per-room mutex so two rapid NEXT events can never both pass
 * the debounce in the same event loop tick.
 */
export function playNextTrackInRoom(
  io: TypedServer,
  roomId: string,
  playMode: PlayMode,
  options?: { skipDebounce?: boolean },
): Promise<void> {
  return withPlayMutex(roomId, async () => {
    if (options?.skipDebounce) {
      // Still update the timestamp so a normal NEXT right after is debounced
      lastNextTimestamp.set(roomId, Date.now())
    } else if (_isNextDebounced(roomId)) {
      return
    }

    const nextTrack = queueService.getNextTrack(roomId, playMode)
    if (!nextTrack) {
      stopPlayback(io, roomId)
      return
    }

    const success = await _playTrackInRoom(io, roomId, nextTrack)
    if (!success) {
      const skipTrack = queueService.getNextTrack(roomId, playMode)
      if (skipTrack) await _playTrackInRoom(io, roomId, skipTrack)
    }

    // Refresh debounce timestamp after async work completes.
    // Without this, a second PLAYER_NEXT waiting on the mutex could pass
    // the debounce check if _playTrackInRoom took longer than 500ms (e.g.
    // stream URL resolution), causing a double-skip.
    lastNextTimestamp.set(roomId, Date.now())
  })
}

/**
 * Go to the previous track in the queue. Same mutex serialization as next.
 */
export function playPrevTrackInRoom(
  io: TypedServer,
  roomId: string,
  options?: { skipDebounce?: boolean },
): Promise<void> {
  return withPlayMutex(roomId, async () => {
    if (options?.skipDebounce) {
      lastNextTimestamp.set(roomId, Date.now())
    } else if (_isNextDebounced(roomId)) {
      return
    }

    const prevTrack = queueService.getPreviousTrack(roomId)
    if (!prevTrack) return

    const success = await _playTrackInRoom(io, roomId, prevTrack)
    if (!success) {
      const skipTrack = queueService.getPreviousTrack(roomId)
      if (skipTrack) await _playTrackInRoom(io, roomId, skipTrack)
    }

    // Refresh debounce timestamp after async work (same rationale as playNextTrackInRoom)
    lastNextTimestamp.set(roomId, Date.now())
  })
}

// ---------------------------------------------------------------------------
// Playback sync for newly-joined clients
// ---------------------------------------------------------------------------

/**
 * Send current playback state to a socket that just joined a room.
 * Handles auto-resume when alone, and auto-play from queue.
 */
export async function syncPlaybackToSocket(
  io: TypedServer,
  socket: TypedSocket,
  roomId: string,
  room: RoomData,
): Promise<void> {
  const isAloneInRoom = room.users.filter((user) => user.online !== false).length === 1

  if (room.currentTrack?.streamUrl) {
    // Alone in room + track was paused → auto-resume (user rejoining)
    const shouldAutoPlay = isAloneInRoom || room.playState.isPlaying
    if (isAloneInRoom && !room.playState.isPlaying) {
      room.playState = { ...room.playState, isPlaying: true, serverTimestamp: Date.now() }
    }

    const snapshotCurrentTime = estimateCurrentTime(roomId)
    const snapshotTimestamp = Date.now()
    const joinCalibrationDelayMs = NTP.INITIAL_INTERVAL_MS * NTP.MAX_INITIAL_SAMPLES + 100
    const scheduleTime = shouldAutoPlay
      ? Math.max(getScheduleTime(roomId), snapshotTimestamp + joinCalibrationDelayMs)
      : snapshotTimestamp
    const delaySec = shouldAutoPlay ? Math.max(0, (scheduleTime - snapshotTimestamp) / 1000) : 0

    socket.emit(EVENTS.PLAYER_PLAY, {
      track: room.currentTrack,
      playState: {
        isPlaying: shouldAutoPlay,
        currentTime: snapshotCurrentTime + delaySec,
        serverTimestamp: scheduleTime,
        serverTimeToExecute: scheduleTime,
      },
    })
  } else if (isAloneInRoom && room.queue.length > 0) {
    // No current track but queue has items → start playing from queue
    const firstTrack = room.queue[0]
    await playTrackInRoom(io, roomId, firstTrack)
  }
}

// ---------------------------------------------------------------------------
// Room cleanup, debounce & conductor report validation
// ---------------------------------------------------------------------------

/** Debounce tracking for PLAYER_NEXT per room */
const lastNextTimestamp = new Map<string, number>()

/** Track consecutive rejected conductor reports per room to break deadlocks */
const conductorRejectCount = new Map<string, number>()

/** Force-accept a conductor report after this many consecutive rejections */
const CONDUCTOR_REJECT_FORCE_ACCEPT_COUNT = 2

/** Max allowed drift (seconds) between conductor-reported time and server estimate */
const CONDUCTOR_REJECT_DRIFT_THRESHOLD_S = 3

/** Remove per-room entries for a deleted room */
export function cleanupRoom(roomId: string): void {
  lastNextTimestamp.delete(roomId)
  conductorRejectCount.delete(roomId)
  playMutexes.delete(roomId)
}

/**
 * Validate a conductor sync report against the server estimate.
 * Returns true if the report should be ACCEPTED, false if rejected (stale).
 * Automatically force-accepts after CONDUCTOR_REJECT_FORCE_ACCEPT_COUNT consecutive
 * rejections to break deadlocks when the server estimate has diverged.
 */
export function validateConductorReport(roomId: string, reportedTime: number, estimatedTime: number): boolean {
  if (estimatedTime - reportedTime > CONDUCTOR_REJECT_DRIFT_THRESHOLD_S) {
    const count = (conductorRejectCount.get(roomId) ?? 0) + 1
    conductorRejectCount.set(roomId, count)
    if (count < CONDUCTOR_REJECT_FORCE_ACCEPT_COUNT) {
      return false // reject
    }
    // Too many consecutive rejections — force accept to break deadlock
    logger.warn(`Force-accepting conductor report after ${count} consecutive rejections`, { roomId })
  }
  // Accepted — reset counter
  conductorRejectCount.delete(roomId)
  return true
}

/**
 * Check and update the next-track debounce for a room.
 * Returns true if the action should be SKIPPED (too soon), false if allowed.
 * Internal: called inside mutex to prevent same-tick race conditions.
 */
function _isNextDebounced(roomId: string): boolean {
  const now = Date.now()
  const lastNext = lastNextTimestamp.get(roomId) ?? 0
  if (now - lastNext < config.player.nextDebounceMs) return true
  lastNextTimestamp.set(roomId, now)
  return false
}
