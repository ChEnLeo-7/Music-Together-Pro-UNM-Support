import { Router, type Router as RouterType } from 'express'
import { roomRepo } from '../repositories/roomRepository.js'
import { revealRoomPassword } from '../services/roomCredentialService.js'
import { listRooms } from '../services/roomService.js'

const router: RouterType = Router()

// Public lobby data. Hidden rooms are filtered by the repository and no
// membership, credential, or platform-auth data is exposed here.
router.get('/', (_req, res) => {
  res.json({ rooms: listRooms() })
})

/** Validate roomId: alphanumeric + _ -, 1-20 chars (matches nanoid urlAlphabet) */
function isValidRoomId(roomId: string): boolean {
  return typeof roomId === 'string' && roomId.length >= 1 && roomId.length <= 20 && /^[A-Za-z0-9_-]+$/.test(roomId)
}

/**
 * GET /api/rooms/:roomId/check
 * Pre-check whether a room exists and whether it requires a password.
 * Used by the client before showing the InteractionGate so that:
 *   - Non-existent rooms redirect immediately (no pointless gate click)
 *   - Password-protected rooms show a password field inside the gate
 */
router.get('/:roomId/check', (req, res) => {
  const { roomId } = req.params
  if (!isValidRoomId(roomId)) {
    res.status(400).json({ error: 'Invalid room ID' })
    return
  }
  const room = roomRepo.get(roomId)

  if (!room) {
    res.status(404).json({ exists: false })
    return
  }

  res.json({
    exists: true,
    hasPassword: room.credential !== null,
    name: room.name,
    hidden: room.hidden,
    permanent: room.permanent,
    userCount: room.users.filter((user) => user.online !== false).length,
    mayJoinWithoutPassword: req.identityUserId === room.creatorId,
  })
})

router.get('/:roomId/password', (req, res) => {
  const { roomId } = req.params
  res.setHeader('Cache-Control', 'no-store')
  if (!isValidRoomId(roomId)) {
    res.status(400).json({ error: 'INVALID_INPUT' })
    return
  }

  const room = roomRepo.get(roomId)
  if (!room) {
    res.status(404).json({ error: 'ROOM_NOT_FOUND' })
    return
  }
  if (!req.identityUserId || req.identityUserId !== room.creatorId) {
    res.status(403).json({ error: 'NO_PERMISSION' })
    return
  }

  try {
    res.json({ password: room.credential ? revealRoomPassword(room.credential) : null })
  } catch {
    res.status(500).json({ error: 'INTERNAL' })
  }
})

export default router
