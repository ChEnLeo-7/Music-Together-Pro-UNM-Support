import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { issueIdentityCookie } from '../services/identityService.js'
import { logger } from '../utils/logger.js'
import { userRepo } from '../repositories/userRepository.js'
import { databasePath } from '../repositories/database.js'
import bcrypt from 'bcryptjs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import * as z from 'zod/v4'

const router: RouterType = Router()

/**
 * Ensure identity cookie exists, and renew expiry on every call.
 * Returns 204 and exposes identity metadata via headers.
 */
router.post('/identity/bootstrap', (req: Request, res: Response) => {
  const hasExistingIdentity = typeof req.identityUserId === 'string' && req.identityUserId.length > 0
  const issued = issueIdentityCookie(req, res, req.identityUserId)
  userRepo.ensure(issued.userId)
  req.identityUserId = issued.userId
  res.setHeader('Access-Control-Expose-Headers', 'X-Identity-UserId, X-Identity-Expires-At')
  res.setHeader('X-Identity-UserId', issued.userId)
  res.setHeader('X-Identity-Expires-At', String(issued.expiresAt))
  logger.info('Identity bootstrap issued', {
    userId: issued.userId,
    reusedIdentity: hasExistingIdentity,
    expiresAt: issued.expiresAt,
    ip: req.ip,
  })
  res.status(204).send()
})

router.post('/identity/logout', (req: Request, res: Response) => {
  const issued = issueIdentityCookie(req, res)
  userRepo.ensure(issued.userId)
  req.identityUserId = issued.userId
  res.json({
    userId: issued.userId,
    expiresAt: issued.expiresAt,
  })
})

router.get('/me', (req: Request, res: Response) => {
  if (!req.identityUserId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const user = userRepo.ensure(req.identityUserId)
  res.json({
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    hasPassword: Boolean(user.passwordHash),
    role: user.role,
  })
})

const setPasswordSchema = z.object({
  password: z.string().min(8).max(128),
})

const updateMeSchema = z.object({
  nickname: z.string().min(1).max(40).optional(),
})

router.patch('/me', (req: Request, res: Response) => {
  if (!req.identityUserId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const parsed = updateMeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile' })
    return
  }

  const user = userRepo.updateProfile(req.identityUserId, { nickname: parsed.data.nickname?.trim() })
  res.json({
    id: user?.id,
    nickname: user?.nickname,
    avatarUrl: user?.avatarUrl,
    hasPassword: Boolean(user?.passwordHash),
    role: user?.role,
  })
})

router.post('/me/password', async (req: Request, res: Response) => {
  if (!req.identityUserId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const parsed = setPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid password' })
    return
  }
  const user = userRepo.ensure(req.identityUserId)
  if (user.passwordHash) {
    res.status(409).json({ error: 'Password already set' })
    return
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12)
  userRepo.setPasswordHash(user.id, passwordHash)
  res.json({ accountId: user.id })
})

const avatarSchema = z.object({
  image: z.string().min(1),
})

router.post('/me/avatar', async (req: Request, res: Response) => {
  if (!req.identityUserId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const parsed = avatarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid image' })
    return
  }

  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(parsed.data.image)
  if (!match) {
    res.status(400).json({ error: 'Only PNG, JPEG, and WebP images are supported' })
    return
  }

  const input = Buffer.from(match[2]!, 'base64')
  if (input.length > 5 * 1024 * 1024) {
    res.status(413).json({ error: 'Avatar must be 5MB or smaller' })
    return
  }

  try {
    const output = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'center' })
      .webp({ quality: 82 })
      .toBuffer()

    const avatarsDir = path.join(path.dirname(databasePath), 'avatars')
    await mkdir(avatarsDir, { recursive: true })
    const fileName = `${req.identityUserId}.webp`
    await writeFile(path.join(avatarsDir, fileName), output)

    const avatarUrl = `/uploads/avatars/${fileName}?v=${Date.now()}`
    const user = userRepo.updateProfile(req.identityUserId, { avatarUrl })
    res.json({
      id: user?.id,
      avatarUrl,
    })
  } catch (err) {
    logger.warn('Avatar processing failed', { err, userId: req.identityUserId })
    res.status(400).json({ error: 'Invalid image data' })
  }
})

const recoverSchema = z.object({
  accountId: z.string().min(1),
  password: z.string().min(1),
})

router.post('/identity/recover', async (req: Request, res: Response) => {
  const parsed = recoverSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }
  const user = userRepo.get(parsed.data.accountId)
  if (!user?.passwordHash) {
    res.status(401).json({ error: 'Invalid account id or password' })
    return
  }
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash)
  if (!ok) {
    res.status(401).json({ error: 'Invalid account id or password' })
    return
  }
  const issued = issueIdentityCookie(req, res, user.id)
  userRepo.ensure(user.id)
  res.json({
    userId: user.id,
    expiresAt: issued.expiresAt,
  })
})

export default router
