import {
  EVENTS,
  ERROR_CODE,
  audioQualitySchema,
  defineAbilityFor,
  playerSeekSchema,
  playerSetModeSchema,
  playerNextSchema,
  playerReadySchema,
  playerSyncSchema,
  queueAddSchema,
} from '@music-together/shared'
import * as z from 'zod/v4'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import type { Track } from '@music-together/shared'
import { createWithPermission } from '../middleware/withControl.js'
import { createWithRoom } from '../middleware/withRoom.js'
import { checkSocketRateLimit } from '../middleware/socketRateLimiter.js'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import { roomRepo } from '../repositories/roomRepository.js'
import * as playerService from '../services/playerService.js'
import * as roomService from '../services/roomService.js'
import { estimateCurrentTime } from '../services/syncService.js'
import { logger } from '../utils/logger.js'

const playerPlaySchema = z
  .object({
    audioQuality: audioQualitySchema.optional(),
    sourcePriority: z.enum(['smart', 'platform-first', 'platform-only', 'unm-first', 'unm-only']).optional(),
    forceRefreshStream: z.boolean().optional(),
  })
  .passthrough()

const realtimeEventLimiter = new RateLimiterMemory({ points: 40, duration: 5 })

async function checkRealtimeRateLimit(socket: TypedSocket): Promise<boolean> {
  try {
    await realtimeEventLimiter.consume(socket.data.identityUserId ?? socket.id)
    return true
  } catch {
    return false
  }
}

export function registerPlayerController(io: TypedServer, socket: TypedSocket) {
  const withPermission = createWithPermission(io)

  socket.on(
    EVENTS.PLAYER_PLAY,
    withPermission('play', 'Player', async (ctx, data) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const parsed = playerPlaySchema.safeParse(data ?? {})
      if (!parsed.success) return
      const suppliedTrack = data?.track ? queueAddSchema.safeParse({ track: data.track }) : null
      if (suppliedTrack && !suppliedTrack.success) return
      const track = suppliedTrack?.success
        ? (ctx.room.queue.find((queued) => queued.id === suppliedTrack.data.track.id) ??
          (ctx.room.currentTrack?.id === suppliedTrack.data.track.id ? ctx.room.currentTrack : undefined))
        : (ctx.room.currentTrack ?? ctx.room.queue[0])
      if (!track) return

      // Resume: same track already loaded and has stream URL → keep position
      if (!data?.track && ctx.room.currentTrack?.id === track.id && ctx.room.currentTrack?.streamUrl) {
        await playerService.resumeTrack(ctx.io, ctx.roomId, ctx.socket)
        return
      }

      await playerService.playTrackInRoom(ctx.io, ctx.roomId, track, {
        audioQuality: parsed.data.audioQuality,
        sourcePriority: parsed.data.sourcePriority,
        forceRefreshStream: parsed.data.forceRefreshStream,
      })
    }),
  )

  socket.on(
    EVENTS.PLAYER_PAUSE,
    withPermission('pause', 'Player', async (ctx) => {
      await playerService.pauseTrack(ctx.io, ctx.roomId, ctx.socket)
    }),
  )

  socket.on(EVENTS.PLAYER_READY, (raw) => {
    const parsed = playerReadySchema.safeParse(raw)
    if (!parsed.success) return
    const mapping = roomRepo.getSocketMapping(socket.id)
    if (!mapping || !roomRepo.isSocketPlaybackCapable(socket.id)) return
    playerService.markPlaybackReady(mapping.roomId, socket.id, parsed.data.trackId, parsed.data.playbackRevision)
  })

  socket.on(
    EVENTS.PLAYER_SEEK,
    withPermission('seek', 'Player', async (ctx, data) => {
      const parsed = playerSeekSchema.safeParse(data)
      if (!parsed.success) return
      await playerService.seekTrack(ctx.io, ctx.roomId, parsed.data.currentTime, ctx.socket)
    }),
  )

  // Conductor (hostId) auto-next bypasses CASL — system behavior, not manual user action.
  // Non-conductor manual next still requires CASL permission check.
  const withRoom = createWithRoom(io)
  socket.on(
    EVENTS.PLAYER_NEXT,
    withRoom(async (ctx, raw) => {
      const parsed = playerNextSchema.safeParse(raw)
      if (!parsed.success) return
      if (ctx.user.id !== ctx.room.hostId) {
        const ability = defineAbilityFor(ctx.user.role)
        if (!ability.can('next', 'Player')) {
          ctx.socket.emit(EVENTS.ROOM_ERROR, {
            code: ERROR_CODE.NO_PERMISSION,
            message: '你没有权限执行此操作',
          })
          return
        }
      }
      if (parsed.data?.reason === 'ended') {
        if (ctx.room.conductorSocketId && ctx.room.conductorSocketId !== ctx.socket.id) return
        if (parsed.data.trackId !== ctx.room.currentTrack?.id) return
        if (parsed.data.playbackRevision !== ctx.room.playState.playbackRevision) return
      }
      await playerService.playNextTrackInRoom(ctx.io, ctx.roomId, ctx.room.playMode)
    }),
  )

  socket.on(
    EVENTS.PLAYER_PREV,
    withPermission('prev', 'Player', async (ctx) => {
      await playerService.playPrevTrackInRoom(ctx.io, ctx.roomId)
    }),
  )

  socket.on(
    EVENTS.PLAYER_SET_MODE,
    withPermission('set-mode', 'Player', (ctx, data) => {
      const parsed = playerSetModeSchema.safeParse(data)
      if (!parsed.success) return
      ctx.room.playMode = parsed.data.mode
      // Broadcast updated room state so all clients see the new play mode
      ctx.io.to(ctx.roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(ctx.room))
      logger.info(`Play mode set to ${parsed.data.mode}`, {
        roomId: ctx.roomId,
      })
    }),
  )

  // ---------------------------------------------------------------------------
  // NTP clock synchronisation – reply instantly with server time
  // ---------------------------------------------------------------------------
  socket.on(EVENTS.NTP_PING, async (data) => {
    try {
      const serverReceiveTime = Date.now()
      if (!(await checkRealtimeRateLimit(socket))) return
      // Store client-reported RTT for adaptive scheduling delay
      if (data?.lastRttMs != null && data.lastRttMs > 0 && data.lastRttMs <= 10_000) {
        roomRepo.setSocketRTT(socket.id, data.lastRttMs)
      }

      const serverSendTime = Date.now()
      socket.emit(EVENTS.NTP_PONG, {
        clientPingId: data?.clientPingId ?? 0,
        serverTime: serverSendTime,
        serverReceiveTime,
        serverSendTime,
      })
    } catch (err) {
      logger.error('NTP_PING handler error', err, { socketId: socket.id })
    }
  })

  // Conductor reports real playback position (keeps server-side playState accurate
  // for mid-song joiners and reconnection recovery — no forwarding to clients)
  socket.on(EVENTS.PLAYER_SYNC, async (raw) => {
    try {
      if (!(await checkRealtimeRateLimit(socket))) return
      const parsed = playerSyncSchema.safeParse(raw)
      if (!parsed.success) return
      const { currentTime } = parsed.data

      const mapping = roomRepo.getSocketMapping(socket.id)
      if (!mapping) return
      const room = roomRepo.get(mapping.roomId)
      if (!room) return
      // Only accept reports from the conductor
      if (room.hostId !== mapping.userId) return
      if (room.conductorSocketId && room.conductorSocketId !== socket.id) return
      if (parsed.data.trackId !== undefined && parsed.data.trackId !== room.currentTrack?.id) return
      if (
        parsed.data.playbackRevision !== undefined &&
        parsed.data.playbackRevision !== room.playState.playbackRevision
      ) {
        return
      }

      // Reject stale reports from a sleeping conductor: if the reported position is
      // far behind the server's estimate, the conductor likely just woke from sleep
      // and hasn't drift-corrected yet.  Accepting this would poison the server
      // state and cause all other clients to seek backwards.
      if (room.playState.isPlaying) {
        const estimated = estimateCurrentTime(mapping.roomId)
        if (!playerService.validateConductorReport(mapping.roomId, currentTime, estimated)) {
          return
        }
      }

      // Prefer hostServerTime (NTP-calibrated) to eliminate Host→Server
      // one-way network delay (~RTT/2) from estimateCurrentTime.
      // Fall back to Date.now() if missing or unreasonably far from server clock.
      const serverNow = Date.now()
      const timestamp =
        parsed.data.hostServerTime && Math.abs(parsed.data.hostServerTime - serverNow) < 10_000
          ? parsed.data.hostServerTime
          : serverNow
      room.playState = {
        ...room.playState,
        currentTime,
        serverTimestamp: timestamp,
      }
    } catch (err) {
      // Sync is best-effort; log but don't emit error to avoid noise
      logger.error('PLAYER_SYNC handler error', err, { socketId: socket.id })
    }
  })

  socket.on(EVENTS.PLAYER_SYNC_REQUEST, async () => {
    try {
      if (!(await checkRealtimeRateLimit(socket))) return
      const mapping = roomRepo.getSocketMapping(socket.id)
      if (!mapping) return
      const room = roomRepo.get(mapping.roomId)
      if (!room) return

      socket.emit(EVENTS.PLAYER_SYNC_RESPONSE, {
        currentTime: estimateCurrentTime(mapping.roomId),
        isPlaying: room.playState.isPlaying,
        serverTimestamp: Date.now(),
        playbackRevision: room.playState.playbackRevision,
        trackId: room.currentTrack?.id,
      })
    } catch (err) {
      logger.error('PLAYER_SYNC_REQUEST handler error', err, {
        socketId: socket.id,
      })
    }
  })
}
