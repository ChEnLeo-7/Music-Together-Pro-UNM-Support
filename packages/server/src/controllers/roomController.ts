import {
  ERROR_CODE,
  EVENTS,
  roomCreateSchema,
  roomJoinSchema,
  roomSettingsSchema,
  setRoleSchema,
} from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { createWithOwnerOnly, isRoomManager } from '../middleware/withControl.js'
import { createWithRoom } from '../middleware/withRoom.js'
import { cleanupSocketRateLimit } from '../middleware/socketRateLimiter.js'
import { roomRepo } from '../repositories/roomRepository.js'
import * as chatService from '../services/chatService.js'
import * as playerService from '../services/playerService.js'
import { issueRejoinTicket, revokeRejoinTickets } from '../services/rejoinTicketService.js'
import { destroyRoom } from '../services/roomLifecycleService.js'
import * as roomService from '../services/roomService.js'
import * as voteService from '../services/voteService.js'
import { logger } from '../utils/logger.js'
import type { RoomData } from '../repositories/types.js'

export function registerRoomController(io: TypedServer, socket: TypedSocket) {
  const withOwnerOnly = createWithOwnerOnly(io)
  const withRoom = createWithRoom(io)

  // ---- Room list (涓嶉渶瑕佸湪鎴块棿鍐? ----
  socket.on(EVENTS.ROOM_LIST, () => {
    try {
      socket.emit(EVENTS.ROOM_LIST_UPDATE, roomService.listRooms())
    } catch (err) {
      logger.error('ROOM_LIST handler error', err, { socketId: socket.id })
    }
  })

  // ---- Create room (鍚彲閫夊瘑鐮? ----
  socket.on(EVENTS.ROOM_CREATE, (raw) => {
    try {
      const parsed = roomCreateSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '杈撳叆鏍煎紡閿欒',
        })
        return
      }
      const { nickname, roomName, password } = parsed.data

      // Auto-leave any previous room before creating a new one
      handleLeave(io, socket, 'auto-leave before create', true)

      const { room, user } = roomService.createRoom(
        socket.id,
        nickname.trim(),
        roomName,
        password,
        socket.data.identityUserId,
      )

      socket.leave('lobby')
      socket.join(room.id)
      socket.emit(EVENTS.ROOM_CREATED, { roomId: room.id, userId: user.id })
      socket.emit(EVENTS.ROOM_STATE, roomService.toPublicRoomStateForOwner(room, { includeQueue: true }))
      const rejoin = issueRejoinTicket(room.id, user.id)
      socket.emit(EVENTS.ROOM_REJOIN_TOKEN, { roomId: room.id, token: rejoin.token, expiresAt: rejoin.expiresAt })

      roomService.broadcastRoomList(io)
    } catch (err) {
      logger.error('ROOM_CREATE handler error', err, { socketId: socket.id })
      socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INTERNAL, message: '服务器内部错误' })
    }
  })

  // ---- Join room (鍚瘑鐮佹牎楠? ----
  socket.on(EVENTS.ROOM_JOIN, (raw) => {
    try {
      const parsed = roomJoinSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '杈撳叆鏍煎紡閿欒',
        })
        return
      }
      const { roomId, nickname, password, rejoinToken } = parsed.data

      // Validate join request (password, rejoin scenarios) 鈥?pure business logic
      const validation = roomService.validateJoinRequest(
        roomId,
        socket.id,
        socket.data.identityUserId,
        password,
        rejoinToken,
      )
      if (!validation.valid) {
        socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE[validation.errorCode as keyof typeof ERROR_CODE] ?? ERROR_CODE.JOIN_FAILED,
          message: validation.errorMessage ?? '鍔犲叆鎴块棿澶辫触',
        })
        return
      }

      // Auto-leave any previous room (different from target) before joining
      const existingMapping = roomRepo.getSocketMapping(socket.id)
      if (existingMapping && existingMapping.roomId !== roomId) {
        handleLeave(io, socket, 'auto-leave before join', true)
      }

      const result = roomService.joinRoom(socket.id, roomId, nickname.trim(), socket.data.identityUserId)
      if (!result) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.JOIN_FAILED, message: '鍔犲叆鎴块棿澶辫触' })
        return
      }

      const { room: updatedRoom, user, hostChanged, roleChanged, hadMemberRecord } = result
      const rejoin = issueRejoinTicket(roomId, user.id)

      socket.leave('lobby')
      socket.join(roomId)

      // Send full room state + chat history
      // Owner 鏀跺埌鍚瘑鐮佺増鏈紝鍏朵粬鎴愬憳鏀跺埌涓嶅惈瀵嗙爜鐗堟湰
      const canManageRoom = user.role === 'owner' || roomService.isServerAdminUser(user.id)
      const stateForJoiner = canManageRoom
        ? roomService.toPublicRoomStateForOwner(updatedRoom, { includeQueue: true })
        : roomService.toPublicRoomState(updatedRoom, { includeQueue: true })
      socket.emit(EVENTS.ROOM_STATE, stateForJoiner)

      // If conductor or roles changed (owner/admin returned, temporary admin cleared),
      // broadcast to ALL OTHER clients so permissions stay in sync.
      if (hostChanged || roleChanged) {
        socket.to(roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(updatedRoom))
      }
      socket.emit(EVENTS.ROOM_REJOIN_TOKEN, { roomId, token: rejoin.token, expiresAt: rejoin.expiresAt })
      if (updatedRoom.chatHistoryForNewUsers || hadMemberRecord) {
        socket.emit(EVENTS.CHAT_HISTORY, chatService.getHistory(roomId))
      } else {
        socket.emit(EVENTS.CHAT_HISTORY, [])
      }

      // Sync playback state to the joining client (auto-resume, auto-play)
      playerService.syncPlaybackToSocket(io, socket, roomId, updatedRoom).catch((err) => {
        logger.error('syncPlaybackToSocket failed', err, { roomId })
      })

      // Send active vote state if one is in progress
      const activeVote = voteService.getActiveVote(roomId)
      if (activeVote) {
        socket.emit(EVENTS.VOTE_STARTED, voteService.toVoteState(activeVote))
      }

      // Notify others (skip for rejoin 鈥?they already know the user is in the room)
      if (!validation.isRejoin) {
        socket.to(roomId).emit(EVENTS.ROOM_USER_JOINED, user)
        // System message for user joined (server-authoritative)
        const joinMsg = chatService.createSystemMessage(roomId, `${user.nickname} 加入了房间`)
        io.to(roomId).emit(EVENTS.CHAT_MESSAGE, joinMsg)
      }

      // 鏇存柊澶у巺鎴块棿鍒楄〃锛堜汉鏁板彉浜嗭級
      roomService.broadcastRoomList(io)
    } catch (err) {
      logger.error('ROOM_JOIN handler error', err, { socketId: socket.id })
      socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INTERNAL, message: '服务器内部错误' })
    }
  })

  // ---- Leave room (explicit user action) ----
  socket.on(EVENTS.ROOM_LEAVE, () => {
    try {
      logger.info(`ROOM_LEAVE event from ${socket.id}`, { socketId: socket.id })
      handleLeave(io, socket, undefined, true)
    } catch (err) {
      logger.error('ROOM_LEAVE handler error', err, { socketId: socket.id })
    }
  })

  socket.on(
    EVENTS.ROOM_DISSOLVE,
    withRoom((ctx) => {
      const canDissolve = ctx.user.role === 'owner' || roomService.isServerAdminUser(ctx.socket.data.identityUserId)
      if (!canDissolve) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.NO_PERMISSION,
          message: '只有房主或服务器管理员可以解散房间',
        })
        return
      }

      const destroyed = destroyRoom(ctx.roomId, io)
      if (!destroyed) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.ROOM_NOT_FOUND, message: '房间不存在' })
        return
      }

      logger.info(`Room ${ctx.roomId} dissolved by ${ctx.user.nickname}`, {
        roomId: ctx.roomId,
        userId: ctx.user.id,
      })
    }),
  )

  socket.on(
    EVENTS.ROOM_REFRESH,
    withRoom((ctx) => {
      ctx.socket.emit(
        EVENTS.ROOM_STATE,
        isRoomManager(ctx)
          ? roomService.toPublicRoomStateForOwner(ctx.room, { includeQueue: true })
          : roomService.toPublicRoomState(ctx.room, { includeQueue: true }),
      )
    }),
  )

  // ---- Room settings (浠呮埧涓伙紝鍚瘑鐮佺鐞? ----
  socket.on(
    EVENTS.ROOM_SETTINGS,
    withOwnerOnly((ctx, raw) => {
      const parsed = roomSettingsSchema.safeParse(raw)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '杈撳叆鏍煎紡閿欒',
        })
        return
      }

      roomService.updateSettings(ctx.roomId, {
        name: parsed.data.name,
        password: parsed.data.password,
        audioQuality: parsed.data.audioQuality,
        sourcePriority: parsed.data.sourcePriority,
        hidden: parsed.data.hidden,
        permanent: parsed.data.permanent,
        chatHistoryForNewUsers: parsed.data.chatHistoryForNewUsers,
      })

      const updatedRoom = roomRepo.get(ctx.roomId)
      if (!updatedRoom) return

      // 浠?owner 鏀跺埌瀵嗙爜鏄庢枃锛屽叾浠栨垚鍛樺彧鏀跺埌 hasPassword 鏍囪
      const baseSettings = {
        name: updatedRoom.name,
        hasPassword: updatedRoom.password !== null,
        audioQuality: updatedRoom.audioQuality,
        sourcePriority: updatedRoom.sourcePriority,
        hidden: updatedRoom.hidden,
        permanent: updatedRoom.permanent,
        chatHistoryForNewUsers: updatedRoom.chatHistoryForNewUsers,
      }
      ctx.io.to(ctx.roomId).emit(EVENTS.ROOM_SETTINGS, baseSettings)
      emitRoomStateByPermission(io, ctx.roomId, updatedRoom)

      logger.info(`Room ${ctx.roomId} settings updated`, { roomId: ctx.roomId })

      // 瀵嗙爜鍙樻洿涔熻鍒锋柊澶у巺鍒楄〃
      roomService.broadcastRoomList(io)
    }),
  )

  // ---- Set user role (浠呮埧涓? ----
  socket.on(
    EVENTS.ROOM_SET_ROLE,
    withOwnerOnly((ctx, raw) => {
      const parsed = setRoleSchema.safeParse(raw)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '杈撳叆鏍煎紡閿欒',
        })
        return
      }

      const { userId, role } = parsed.data
      const result = roomService.setUserRole(ctx.roomId, userId, role)
      if (!result.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.SET_ROLE_FAILED, message: '鏃犳硶璁剧疆璇ョ敤鎴风殑瑙掕壊' })
        return
      }

      io.to(ctx.roomId).emit(EVENTS.ROOM_ROLE_CHANGED, { userId, role })
      if (result.hostChanged || result.roleChanged) {
        // Owner must keep receiving the password-bearing state; other members
        // (including temporary admins) only receive the public state.
        emitRoomStateByPermission(io, ctx.roomId, ctx.room)
      }
      logger.info(`Role changed: ${userId} -> ${role} in room ${ctx.roomId}`, { roomId: ctx.roomId })
    }),
  )

  socket.on(
    EVENTS.ROOM_HIDE_MEMBER,
    withOwnerOnly((ctx, raw) => {
      const userId = typeof raw === 'object' && raw !== null && 'userId' in raw ? String(raw.userId) : ''
      if (!userId) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '杈撳叆鏍煎紡閿欒' })
        return
      }

      const success = roomService.hideMemberRecord(ctx.roomId, userId)
      if (!success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无法删除该成员记录' })
        return
      }

      const updatedRoom = roomRepo.get(ctx.roomId)
      if (!updatedRoom) return
      emitRoomStateByPermission(io, ctx.roomId, updatedRoom)
      roomService.broadcastRoomList(io)
    }),
  )

  // ---- Disconnect ----
  socket.on('disconnect', (reason) => {
    try {
      logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`, { socketId: socket.id })
      handleLeave(io, socket)
      // Safety net: always clean up socket mapping, RTT data, and rate limiter.
      // handleLeave only cleans up if the socket was in a room, but
      // NTP_PING can store RTT even for sockets that never joined a room.
      roomRepo.deleteSocketMapping(socket.id)
      cleanupSocketRateLimit(socket)
    } catch (err) {
      logger.error('disconnect handler error', err, { socketId: socket.id })
    }
  })
}

// ---------------------------------------------------------------------------
// Unified leave handler (previously duplicated as autoLeaveCurrentRoom + handleLeave)
// ---------------------------------------------------------------------------

/**
 * Leave the current room (if any), notify other users, and update lobby.
 * Used by ROOM_LEAVE, disconnect, and auto-leave before create/join.
 */
function handleLeave(io: TypedServer, socket: TypedSocket, reason?: string, revokeTicket = false): void {
  const result = roomService.leaveRoom(socket.id, io)
  if (!result) return

  const { roomId, user, room, hostChanged, roleChanged, voteUpdated, staleSocketOnly } = result
  if (revokeTicket) {
    revokeRejoinTickets(roomId, user.id)
  }
  socket.leave(roomId)
  socket.join('lobby')

  // Stale socket cleanup (e.g. page refresh) should only remove this socket
  // from the Socket.IO room; the user remains present via another socket.
  if (staleSocketOnly) return

  io.to(roomId).emit(EVENTS.ROOM_USER_LEFT, user)
  if (room) {
    io.to(roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(room))
  }

  // System message for user left (server-authoritative)
  if (room && room.users.some((u) => u.online !== false)) {
    const leaveMsg = chatService.createSystemMessage(roomId, `${user.nickname} 离开了房间`)
    io.to(roomId).emit(EVENTS.CHAT_MESSAGE, leaveMsg)
  }

  // 瑙掕壊鎴栦富鎸佸彉鏇存椂骞挎挱瀹屾暣鐘舵€侊紝纭繚鎵€鏈夊鎴风鏇存柊 hostId / 鏉冮檺
  // owner 鏀跺埌鍚瘑鐮佺増鏈紝鍏朵粬鎴愬憳涓嶅惈瀵嗙爜
  if ((hostChanged || roleChanged) && room && room.users.some((u) => u.online !== false)) {
    emitRoomStateByPermission(io, roomId, room)
  }

  // Broadcast updated vote state after threshold recalculation
  if (voteUpdated) {
    const activeVote = voteService.getActiveVote(roomId)
    if (activeVote) {
      io.to(roomId).emit(EVENTS.VOTE_STARTED, voteService.toVoteState(activeVote))
    }
  }

  // 鏇存柊澶у巺鎴块棿鍒楄〃
  roomService.broadcastRoomList(io)

  if (reason) {
    logger.info(`${reason}: left room ${roomId} for socket ${socket.id}`, { roomId, socketId: socket.id })
  }
}

function emitRoomStateByPermission(io: TypedServer, roomId: string, room: RoomData): void {
  const managerSocketIds = room.users
    .filter((user) => user.online !== false && (user.role === 'owner' || roomService.isServerAdminUser(user.id)))
    .map((user) => roomRepo.getSocketIdForUser(roomId, user.id))
    .filter((socketId): socketId is string => Boolean(socketId))

  if (managerSocketIds.length === 0) {
    io.to(roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(room))
    return
  }

  for (const socketId of managerSocketIds) {
    io.to(socketId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomStateForOwner(room))
  }
  io.to(roomId).except(managerSocketIds).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(room))
}
