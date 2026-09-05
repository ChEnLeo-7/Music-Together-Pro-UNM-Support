import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function signature(payload: string): string {
  return createHmac('sha256', config.identity.secret).update(payload).digest('base64url')
}

export function createMediaToken(mediaId: string, roomId: string, userId: string, now = Date.now()): string {
  const payload = `${mediaId}.${roomId}.${userId}.${now + TOKEN_TTL_MS}`
  return `${payload}.${signature(payload)}`
}

/** A room-scoped token is used for media URLs broadcast to every room member. */
export function createRoomMediaToken(mediaId: string, roomId: string, now = Date.now()): string {
  const payload = `${mediaId}.${roomId}.*.${now + TOKEN_TTL_MS}`
  return `${payload}.${signature(payload)}`
}

export function verifyMediaToken(token: string, mediaId: string, roomId: string, userId: string, now = Date.now()): boolean {
  const parts = token.split('.')
  if (parts.length !== 5) return false
  const [tokenMediaId, tokenRoomId, tokenUserId, expiresRaw, provided] = parts
  const expiresAt = Number(expiresRaw)
  if (tokenMediaId !== mediaId || tokenRoomId !== roomId || tokenUserId !== userId || !Number.isFinite(expiresAt) || expiresAt <= now) {
    return false
  }
  const expected = signature(parts.slice(0, 4).join('.'))
  const providedBuffer = Buffer.from(provided ?? '')
  const expectedBuffer = Buffer.from(expected)
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer)
}

export function verifyRoomMediaToken(token: string, mediaId: string, roomId: string, now = Date.now()): boolean {
  const parts = token.split('.')
  if (parts.length !== 5) return false
  const [tokenMediaId, tokenRoomId, tokenUserId, expiresRaw, provided] = parts
  const expiresAt = Number(expiresRaw)
  if (tokenMediaId !== mediaId || tokenRoomId !== roomId || tokenUserId !== '*' || !Number.isFinite(expiresAt) || expiresAt <= now) {
    return false
  }
  const expected = signature(parts.slice(0, 4).join('.'))
  const providedBuffer = Buffer.from(provided ?? '')
  const expectedBuffer = Buffer.from(expected)
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer)
}
