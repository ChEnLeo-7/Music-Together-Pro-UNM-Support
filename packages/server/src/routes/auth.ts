import { Router, type Request, type Response, type Router as RouterType } from 'express'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import * as z from 'zod/v4'
import { databasePath } from '../repositories/database.js'
import { userRepo, type PersistedUser } from '../repositories/userRepository.js'
import { AccountAuthError, accountAuth } from '../services/accountAuth.js'
import { clearSessionCookie, setSessionCookie } from '../services/identityService.js'
import { logger } from '../utils/logger.js'

const router: RouterType = Router()
const registerSchema = z.object({ username: z.string().max(64), password: z.string().max(128), nickname: z.string().max(40).default('') })
const loginSchema = z.object({ username: z.string().max(64), password: z.string().max(128) })
const guestSchema = z.object({ nickname: z.string().trim().min(1).max(40) })
const profileSchema = z.object({ nickname: z.string().trim().min(1).max(40) })
const passwordSchema = z.object({ currentPassword: z.string(), newPassword: z.string() })
const bootstrapCredentialsSchema = z.object({
  currentPassword: z.string(),
  newUsername: z.string().max(64),
  newPassword: z.string().max(128),
})
const avatarSchema = z.object({ image: z.string().min(1) })
const attempts = new Map<string, { count: number; resetAt: number }>()
const AUTH_ATTEMPT_LIMIT = 20
const AUTH_ATTEMPT_WINDOW_MS = 60_000
const AUTH_BUCKET_LIMIT = 10_000

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key)
  }
}, AUTH_ATTEMPT_WINDOW_MS).unref()

function consumeAuthAttempt(key: string): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt <= now) {
    if (!entry && attempts.size >= AUTH_BUCKET_LIMIT) return false
    attempts.set(key, { count: 1, resetAt: now + AUTH_ATTEMPT_WINDOW_MS })
    return true
  }
  entry.count += 1
  return entry.count <= AUTH_ATTEMPT_LIMIT
}

function allowAuthAttempt(req: Request, username?: string): boolean {
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  if (!consumeAuthAttempt(`ip:${ip}`)) return false
  return username === undefined || consumeAuthAttempt(`username:${username.trim()}`)
}

function accountDto(user: PersistedUser) {
  return { userId: user.id, kind: user.kind, username: user.username, nickname: user.nickname, avatarUrl: user.avatarUrl, role: user.role, mustChangePassword: user.mustChangePassword, mustChangeUsername: user.mustChangeUsername }
}

function sendAuthError(res: Response, error: unknown): void {
  if (!(error instanceof AccountAuthError)) {
    logger.error('Account operation failed', error)
    res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Account operation failed' })
    return
  }
  const status = error.code === 'INVALID_CREDENTIALS' ? 401
    : error.code === 'USERNAME_TAKEN' || error.code === 'ALREADY_REGISTERED' ? 409
      : error.code === 'REGISTRATION_UNAVAILABLE' ? 503
        : error.code === 'USER_NOT_FOUND' ? 404 : 400
  res.status(status).json({ code: error.code, error: error.message })
}

router.post('/guest', (req, res) => {
  if (!allowAuthAttempt(req)) return void res.status(429).json({ code: 'RATE_LIMITED', error: 'Too many attempts' })
  const parsed = guestSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(400).json({ code: 'INVALID_PROFILE', error: 'Invalid nickname' })
  try {
    const result = accountAuth.createGuest(parsed.data.nickname, req.authPrincipal)
    setSessionCookie(req, res, result.session.token)
    res.status(201).json(accountDto(result.user))
  } catch (error) { sendAuthError(res, error) }
})

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(400).json({ code: 'INVALID_INPUT', error: 'Invalid registration' })
  if (!allowAuthAttempt(req, parsed.data.username)) return void res.status(429).json({ code: 'RATE_LIMITED', error: 'Too many attempts' })
  if (req.authPrincipal?.user.kind === 'account') return void res.status(409).json({ code: 'ALREADY_REGISTERED', error: 'Already registered' })
  try {
    const result = await accountAuth.register(parsed.data, req.authPrincipal?.session)
    setSessionCookie(req, res, result.session.token)
    res.status(201).json(accountDto(result.user))
  } catch (error) { sendAuthError(res, error) }
})

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(401).json({ code: 'INVALID_CREDENTIALS', error: 'Invalid username or password' })
  if (!allowAuthAttempt(req, parsed.data.username)) return void res.status(429).json({ code: 'RATE_LIMITED', error: 'Too many attempts' })
  try {
    const result = await accountAuth.login(parsed.data.username, parsed.data.password, req.authPrincipal?.session.id)
    setSessionCookie(req, res, result.session.token)
    res.json(accountDto(result.user))
  } catch (error) { sendAuthError(res, error) }
})

router.post('/logout', (req, res) => {
  if (req.authPrincipal) {
    accountAuth.logout(req.authPrincipal.session.id)
  }
  clearSessionCookie(req, res)
  res.status(204).send()
})

router.get('/me', (req, res) => {
  if (!req.authPrincipal) return void res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Authentication required' })
  res.json(accountDto(req.authPrincipal.user))
})

router.patch('/me', (req, res) => {
  if (!req.authPrincipal) return void res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Authentication required' })
  const parsed = profileSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(400).json({ code: 'INVALID_PROFILE', error: 'Invalid profile' })
  res.json(accountDto(userRepo.updateProfile(req.authPrincipal.userId, parsed.data)!))
})

router.post('/password/change', async (req, res) => {
  if (!req.authPrincipal) return void res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Authentication required' })
  const parsed = passwordSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(400).json({ code: 'INVALID_PASSWORD', error: 'Invalid password' })
  try {
    const result = await accountAuth.changePassword(req.authPrincipal.userId, parsed.data.currentPassword, parsed.data.newPassword)
    setSessionCookie(req, res, result.session.token)
    res.json(accountDto(result.user))
  } catch (error) { sendAuthError(res, error) }
})

router.post('/credentials/bootstrap-change', async (req, res) => {
  if (!req.authPrincipal) return void res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Authentication required' })
  const parsed = bootstrapCredentialsSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(400).json({ code: 'INVALID_CREDENTIALS', error: 'Invalid credentials' })
  try {
    const result = await accountAuth.changeBootstrapCredentials(
      req.authPrincipal.userId,
      parsed.data.currentPassword,
      parsed.data.newUsername,
      parsed.data.newPassword,
    )
    setSessionCookie(req, res, result.session.token)
    res.json(accountDto(result.user))
  } catch (error) { sendAuthError(res, error) }
})

router.post('/me/avatar', async (req, res) => {
  if (!req.authPrincipal) return void res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Authentication required' })
  const parsed = avatarSchema.safeParse(req.body)
  const match = parsed.success ? /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(parsed.data.image) : null
  if (!match) return void res.status(400).json({ code: 'INVALID_IMAGE', error: 'Invalid image' })
  const input = Buffer.from(match[2]!, 'base64')
  if (input.length > 5 * 1024 * 1024) return void res.status(413).json({ code: 'IMAGE_TOO_LARGE', error: 'Avatar must be 5MB or smaller' })
  try {
    const output = await sharp(input, { failOn: 'error' }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 82 }).toBuffer()
    const avatarsDir = path.join(path.dirname(databasePath), 'avatars')
    await mkdir(avatarsDir, { recursive: true })
    const fileName = `${req.authPrincipal.userId}.webp`
    await writeFile(path.join(avatarsDir, fileName), output)
    const avatarUrl = `/uploads/avatars/${fileName}?v=${Date.now()}`
    userRepo.updateProfile(req.authPrincipal.userId, { avatarUrl })
    res.json({ avatarUrl })
  } catch {
    logger.warn('Avatar processing failed', { userId: req.authPrincipal.userId })
    res.status(400).json({ code: 'INVALID_IMAGE', error: 'Invalid image data' })
  }
})

export default router
