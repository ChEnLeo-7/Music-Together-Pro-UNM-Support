import { Router, type Router as RouterType, type Request, type Response } from 'express'
import * as z from 'zod/v4'
import { EVENTS } from '@music-together/shared'
import { roomRepo } from '../repositories/roomRepository.js'
import { persistentRoomRepo } from '../repositories/persistentRoomRepository.js'
import { canConfigureRoomUnm, getUnmServerUrl, normalizeUnmServerUrl } from '../services/runtimeConfigService.js'
import { userRepo } from '../repositories/userRepository.js'
import type { TypedServer } from '../middleware/types.js'
import { toPublicRoomState } from '../utils/roomUtils.js'

const roomQuerySchema = z.object({
  roomId: z.string().min(1),
})

const updateSettingsSchema = z.object({
  roomId: z.string().min(1),
  unmServerUrl: z.string().max(500).optional(),
})

function requireRoomAccess(req: Request, res: Response, roomId: string) {
  const room = roomRepo.get(roomId)
  if (!room) {
    res.status(404).json({ error: 'Room not found' })
    return null
  }
  if (!req.identityUserId || !room.users.some((user) => user.id === req.identityUserId && user.online !== false)) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return room
}

function requireRoomUnmManagerAccess(req: Request, res: Response, roomId: string) {
  const room = requireRoomAccess(req, res, roomId)
  if (!room) return null
  if (!canConfigureRoomUnm(room.creatorId, req.identityUserId, userRepo.isServerAdmin(req.identityUserId ?? ''))) {
    res
      .status(403)
      .json({ code: 'UNM_OWNER_REQUIRED', error: 'Only the room owner or a server administrator can configure UNM' })
    return null
  }
  return room
}

function validateUnmServerUrl(rawUrl: string): string | null {
  const normalized = normalizeUnmServerUrl(rawUrl)
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? normalized : null
  } catch {
    return null
  }
}

export function createSettingsRoutes(io: TypedServer): RouterType {
  const router: RouterType = Router()

  router.get('/', (req: Request, res: Response) => {
    const parsed = roomQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings query' })
      return
    }

    const room = requireRoomUnmManagerAccess(req, res, parsed.data.roomId)
    if (!room) return

    res.json({
      unmServerUrl: getUnmServerUrl(room.id),
      roomUnmServerUrl: room.unmServerUrl,
    })
  })

  router.patch('/', (req: Request, res: Response) => {
    const parsed = updateSettingsSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' })
      return
    }

    const room = requireRoomUnmManagerAccess(req, res, parsed.data.roomId)
    if (!room) return

    const requestedUrl = validateUnmServerUrl(parsed.data.unmServerUrl ?? '')
    if (requestedUrl === null) {
      res.status(400).json({ code: 'INVALID_UNM_URL', error: 'UNM server URL must be a valid HTTP(S) URL' })
      return
    }
    room.unmServerUrl = requestedUrl
    if (room.permanent) persistentRoomRepo.save(room)
    io.to(room.id).emit(EVENTS.ROOM_STATE, toPublicRoomState(room))

    res.json({
      unmServerUrl: getUnmServerUrl(room.id),
      roomUnmServerUrl: room.unmServerUrl,
    })
  })

  return router
}
