import { Router, type Router as RouterType, type Request, type Response } from 'express'
import * as z from 'zod/v4'
import { roomRepo } from '../repositories/roomRepository.js'
import { persistentRoomRepo } from '../repositories/persistentRoomRepository.js'
import { userRepo } from '../repositories/userRepository.js'
import { getUnmServerUrl, normalizeUnmServerUrl } from '../services/runtimeConfigService.js'

const router: RouterType = Router()

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
  if (!req.identityUserId || !room.users.some((user) => user.id === req.identityUserId)) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return room
}

function requireRoomManager(req: Request, res: Response, roomId: string) {
  const room = requireRoomAccess(req, res, roomId)
  if (!room) return null
  const user = room.users.find((member) => member.id === req.identityUserId)
  if (user?.role !== 'owner' && user?.role !== 'admin' && !userRepo.isServerAdmin(req.identityUserId ?? '')) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return room
}

router.get('/', (req: Request, res: Response) => {
  const parsed = roomQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings query' })
    return
  }

  const room = requireRoomManager(req, res, parsed.data.roomId)
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

  const room = requireRoomManager(req, res, parsed.data.roomId)
  if (!room) return

  room.unmServerUrl = normalizeUnmServerUrl(parsed.data.unmServerUrl ?? '')
  if (room.permanent) persistentRoomRepo.save(room)

  res.json({
    unmServerUrl: getUnmServerUrl(room.id),
    roomUnmServerUrl: room.unmServerUrl,
  })
})

export default router
