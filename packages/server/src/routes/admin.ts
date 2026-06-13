import { Router, type NextFunction, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod/v4'
import type { TypedServer } from '../middleware/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { userRepo } from '../repositories/userRepository.js'
import { destroyRoom } from '../services/roomLifecycleService.js'

function requireServerAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.identityUserId || !userRepo.isServerAdmin(req.identityUserId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  next()
}

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(128),
})

export function createAdminRoutes(io: TypedServer): Router {
  const router = Router()
  router.use(requireServerAdmin)

  router.get('/users', (_req, res) => {
    res.json({
      users: userRepo.list().map((user) => ({
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        role: user.role,
        hasPassword: Boolean(user.passwordHash),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastSeenAt: user.lastSeenAt,
      })),
    })
  })

  router.delete('/users/:userId', (req, res) => {
    userRepo.delete(req.params.userId)
    res.status(204).send()
  })

  router.post('/users/:userId/reset-password', async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid password' })
      return
    }
    const user = userRepo.get(req.params.userId)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    userRepo.setPasswordHash(user.id, passwordHash)
    res.status(204).send()
  })

  router.get('/rooms', (_req, res) => {
    res.json({
      rooms: Array.from(roomRepo.getAll().values()).map((room) => ({
        id: room.id,
        name: room.name,
        creatorId: room.creatorId,
        hidden: room.hidden,
        permanent: room.permanent,
        userCount: room.users.filter((user) => user.online !== false).length,
        hasPassword: Boolean(room.password),
        currentTrackTitle: room.currentTrack?.title ?? null,
      })),
    })
  })

  router.post('/rooms/:roomId/dissolve', (req, res) => {
    const destroyed = destroyRoom(req.params.roomId, io)
    if (!destroyed) {
      res.status(404).json({ error: 'Room not found' })
      return
    }
    res.status(204).send()
  })

  return router
}
