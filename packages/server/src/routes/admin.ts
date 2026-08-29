import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod/v4'
import type { TypedServer } from '../middleware/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { persistentRoomRepo } from '../repositories/persistentRoomRepository.js'
import { userRepo } from '../repositories/userRepository.js'
import { destroyRoom } from '../services/roomLifecycleService.js'
import { AccountAuthError, accountAuth } from '../services/accountAuth.js'
import { sessionManager } from '../services/sessionManager.js'
import { cleanupUser as cleanupPlatformAuthUser } from '../services/authService.js'

function requireServerAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.authPrincipal || !userRepo.isServerAdmin(req.authPrincipal.userId)) {
    res.status(403).json({ code: 'NO_PERMISSION', error: 'Forbidden' })
    return
  }
  next()
}

const resetPasswordSchema = z.object({
  newPassword: z.string(),
})

export function createAdminRoutes(io: TypedServer): Router {
  const router = Router()
  router.use(requireServerAdmin)

  router.get('/users', (_req, res) => {
    res.json({
      users: userRepo.list().map(({ passwordHash: _, ...user }) => user),
    })
  })

  router.delete('/users/:userId', (req, res) => {
    try {
      const targetUserId = req.params.userId
      if (!userRepo.get(targetUserId)) {
        res.status(404).json({ code: 'USER_NOT_FOUND', error: 'User not found' })
        return
      }
      const target = userRepo.get(targetUserId)!
      if (target.role === 'admin' && userRepo.countAdmins() <= 1) {
        res.status(409).json({ code: 'LAST_ADMIN', error: 'Cannot delete the last administrator' })
        return
      }
      sessionManager.revokeAllForUser(targetUserId)
      cleanupPlatformAuthUser(targetUserId)
      for (const room of [...roomRepo.getAll().values()]) {
        if (room.creatorId === targetUserId) {
          destroyRoom(room.id, io)
          continue
        }
        room.users = room.users.filter((user) => user.id !== targetUserId)
        room.adminUserIds.delete(targetUserId)
        room.hiddenMemberUserIds.delete(targetUserId)
        if (room.temporaryAdminUserId === targetUserId) room.temporaryAdminUserId = null
        if (room.permanent) persistentRoomRepo.saveRoom(room)
      }
      if (!userRepo.delete(targetUserId)) {
        res.status(404).json({ code: 'USER_NOT_FOUND', error: 'User not found' })
        return
      }
      res.status(204).send()
    } catch (error) {
      if (error instanceof Error && error.message === 'LAST_ADMIN') {
        res.status(409).json({ code: 'LAST_ADMIN', error: 'Cannot delete the last administrator' })
        return
      }
      throw error
    }
  })

  router.post('/users/:userId/reset-password', async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid password' })
      return
    }
    try {
      await accountAuth.resetPasswordByAdmin(req.params.userId, parsed.data.newPassword)
      res.status(204).send()
    } catch (error) {
      if (error instanceof AccountAuthError) {
        res.status(error.code === 'USER_NOT_FOUND' ? 404 : 400).json({ code: error.code, error: error.message })
        return
      }
      throw error
    }
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
        hasPassword: room.credential !== null,
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
