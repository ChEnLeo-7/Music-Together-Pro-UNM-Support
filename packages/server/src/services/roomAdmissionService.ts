import { createHash, randomBytes } from 'node:crypto'
import type { RoomData } from '../repositories/types.js'
import { config } from '../config.js'
import { verifyRoomPassword } from './roomCredentialService.js'

const FAILURE_WINDOW_MS = 5 * 60 * 1000
const FAILURE_LIMIT = 8
const LOCK_MS = 30 * 1000
const SOCKET_WINDOW_MS = 60 * 1000
const SOCKET_LIMIT = 20

interface StoredGrant {
  tokenHash: string
  roomId: string
  userId: string
  sessionId: string
  passwordVersion: number
  expiresAt: number
}

interface RateBucket {
  count: number
  windowStartedAt: number
  lockedUntil: number
}

export interface IssuedRoomGrant {
  token: string
  expiresAt: number
}

export interface AuthorizeRoomJoinInput {
  room: RoomData
  userId: string
  sessionId: string
  password?: string
  grantToken?: string
  sourceIp: string
  socketId: string
}

export type RoomAuthorizationResult =
  | { authorized: true; grant?: IssuedRoomGrant }
  | { authorized: false; errorCode: 'ROOM_PASSWORD_REQUIRED' | 'WRONG_PASSWORD' | 'RATE_LIMITED' }

const grantsByBinding = new Map<string, StoredGrant>()
const grantsByHash = new Map<string, StoredGrant>()
const failureBuckets = new Map<string, RateBucket>()
const socketBuckets = new Map<string, RateBucket>()

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function bindingKey(roomId: string, userId: string, sessionId: string): string {
  return JSON.stringify([roomId, userId, sessionId])
}

function deleteGrant(grant: StoredGrant): void {
  grantsByHash.delete(grant.tokenHash)
  const key = bindingKey(grant.roomId, grant.userId, grant.sessionId)
  if (grantsByBinding.get(key) === grant) grantsByBinding.delete(key)
}

function pruneExpired(now = Date.now()): void {
  for (const grant of grantsByBinding.values()) {
    if (grant.expiresAt <= now) deleteGrant(grant)
  }
}

setInterval(() => pruneExpired(), 60_000).unref()

function pruneRateBuckets(now = Date.now()): void {
  for (const buckets of [failureBuckets, socketBuckets]) {
    if (buckets.size < 10_000) continue
    for (const [key, bucket] of buckets) {
      if (bucket.lockedUntil <= now && now - bucket.windowStartedAt >= FAILURE_WINDOW_MS) buckets.delete(key)
    }
  }
}

function issueGrant(roomId: string, userId: string, sessionId: string, passwordVersion: number): IssuedRoomGrant {
  const key = bindingKey(roomId, userId, sessionId)
  const previous = grantsByBinding.get(key)
  if (previous) deleteGrant(previous)

  const token = randomBytes(32).toString('base64url')
  const grant: StoredGrant = {
    tokenHash: hashToken(token),
    roomId,
    userId,
    sessionId,
    passwordVersion,
    expiresAt: Date.now() + config.roomAdmission.ttlMs,
  }
  grantsByBinding.set(key, grant)
  grantsByHash.set(grant.tokenHash, grant)
  return { token, expiresAt: grant.expiresAt }
}

function validateGrant(token: string, input: AuthorizeRoomJoinInput): IssuedRoomGrant | null {
  const grant = grantsByHash.get(hashToken(token))
  if (!grant) return null
  if (grant.expiresAt <= Date.now()) {
    deleteGrant(grant)
    return null
  }
  if (
    grant.roomId !== input.room.id ||
    grant.userId !== input.userId ||
    grant.sessionId !== input.sessionId ||
    grant.passwordVersion !== input.room.passwordVersion
  ) {
    return null
  }

  // A browser and the Android playback service use sibling sockets bound to
  // the same authenticated session. Keep the bounded, session-bound grant
  // reusable so one socket cannot invalidate the other during reconnect.
  return { token, expiresAt: grant.expiresAt }
}

function consumeBucket(map: Map<string, RateBucket>, key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const current = map.get(key)
  const bucket = !current || now - current.windowStartedAt >= windowMs
    ? { count: 0, windowStartedAt: now, lockedUntil: 0 }
    : current
  if (bucket.lockedUntil > now) return false
  bucket.count += 1
  if (bucket.count > limit) bucket.lockedUntil = now + LOCK_MS
  map.set(key, bucket)
  return bucket.lockedUntil <= now
}

function isFailureLocked(input: AuthorizeRoomJoinInput): boolean {
  const now = Date.now()
  return [`ip:${input.sourceIp}:${input.room.id}`, `user:${input.userId}:${input.room.id}`].some(
    (key) => (failureBuckets.get(key)?.lockedUntil ?? 0) > now,
  )
}

function recordFailure(input: AuthorizeRoomJoinInput): void {
  consumeBucket(failureBuckets, `ip:${input.sourceIp}:${input.room.id}`, FAILURE_LIMIT, FAILURE_WINDOW_MS)
  consumeBucket(failureBuckets, `user:${input.userId}:${input.room.id}`, FAILURE_LIMIT, FAILURE_WINDOW_MS)
}

export function authorizeRoomJoin(input: AuthorizeRoomJoinInput): RoomAuthorizationResult {
  pruneRateBuckets()
  if (!consumeBucket(socketBuckets, input.socketId, SOCKET_LIMIT, SOCKET_WINDOW_MS) || isFailureLocked(input)) {
    return { authorized: false, errorCode: 'RATE_LIMITED' }
  }
  if (!input.room.credential || input.userId === input.room.creatorId) return { authorized: true }

  if (input.grantToken) {
    const grant = validateGrant(input.grantToken, input)
    if (grant) return { authorized: true, grant }
  }

  if (input.password === undefined) {
    recordFailure(input)
    return { authorized: false, errorCode: 'ROOM_PASSWORD_REQUIRED' }
  }
  if (!verifyRoomPassword(input.room.credential, input.password)) {
    recordFailure(input)
    return { authorized: false, errorCode: 'WRONG_PASSWORD' }
  }
  return {
    authorized: true,
    grant: issueGrant(input.room.id, input.userId, input.sessionId, input.room.passwordVersion),
  }
}

export function revokeRoomAdmissionGrants(roomId: string): void {
  for (const grant of [...grantsByBinding.values()]) {
    if (grant.roomId === roomId) deleteGrant(grant)
  }
}

export function revokeUserRoomAdmissionGrants(roomId: string, userId: string): void {
  for (const grant of [...grantsByBinding.values()]) {
    if (grant.roomId === roomId && grant.userId === userId) deleteGrant(grant)
  }
}

export function revokeSessionRoomAdmissionGrants(sessionId: string): void {
  for (const grant of [...grantsByBinding.values()]) {
    if (grant.sessionId === sessionId) deleteGrant(grant)
  }
}

export function revokeUserAdmissionGrants(userId: string): void {
  for (const grant of [...grantsByBinding.values()]) {
    if (grant.userId === userId) deleteGrant(grant)
  }
}
