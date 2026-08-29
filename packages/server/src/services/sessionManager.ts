import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PersistedSession, SessionRepository } from '../repositories/sessionRepository.js'
import type { PersistedUser, UserRepository } from '../repositories/userRepository.js'
import { sessionRepo } from '../repositories/sessionRepository.js'
import { userRepo } from '../repositories/userRepository.js'
import { config } from '../config.js'
import { revokeSessionRoomAdmissionGrants, revokeUserAdmissionGrants } from './roomAdmissionService.js'
import { disconnectSessionSockets, disconnectUserSockets } from './sessionSocketRegistry.js'

export interface IssuedSession {
  id: string
  userId: string
  token: string
  createdAt: number
  expiresAt: number
}

export interface AuthenticatedPrincipal {
  userId: string
  session: PersistedSession
  user: PersistedUser
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

export function createSessionManager(
  sessions: SessionRepository,
  users: UserRepository,
  options: { ttlMs: number; now?: () => number },
) {
  const now = options.now ?? Date.now
  return {
    issue(userId: string): IssuedSession {
      const issuedAt = now()
      const token = randomBytes(32).toString('base64url')
      const session: PersistedSession = {
        id: randomUUID(),
        userId,
        tokenHash: hashSessionToken(token),
        createdAt: issuedAt,
        expiresAt: issuedAt + options.ttlMs,
        lastSeenAt: issuedAt,
        revokedAt: null,
      }
      sessions.create(session)
      return { id: session.id, userId, token, createdAt: issuedAt, expiresAt: session.expiresAt }
    },
    authenticate(rawToken: string): AuthenticatedPrincipal | null {
      if (!rawToken) return null
      const session = sessions.getByTokenHash(hashSessionToken(rawToken))
      const authenticatedAt = now()
      if (!session || session.revokedAt !== null || session.expiresAt <= authenticatedAt) return null
      const user = users.get(session.userId)
      if (!user || user.status !== 'active') return null
      sessions.touch(session.id, authenticatedAt)
      users.touch(user.id, authenticatedAt)
      return { userId: user.id, session: { ...session, lastSeenAt: authenticatedAt }, user }
    },
    revoke(sessionId: string): void {
      sessions.revoke(sessionId, now())
      revokeSessionRoomAdmissionGrants(sessionId)
      disconnectSessionSockets(sessionId)
    },
    revokeAllForUser(userId: string): void {
      sessions.revokeAllForUser(userId, now())
      revokeUserAdmissionGrants(userId)
      disconnectUserSockets(userId)
    },
    revokeAllExcept(userId: string, sessionId: string): void { sessions.revokeAllExcept(userId, sessionId, now()) },
  }
}

export type SessionManager = ReturnType<typeof createSessionManager>
export const sessionManager = createSessionManager(sessionRepo, userRepo, { ttlMs: config.session.ttlMs })
