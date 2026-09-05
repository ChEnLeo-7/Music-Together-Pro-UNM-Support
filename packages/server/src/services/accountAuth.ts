import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import type { PersistedSession } from '../repositories/sessionRepository.js'
import type { PersistedUser, UserRepository } from '../repositories/userRepository.js'
import type { IssuedSession, SessionManager } from './sessionManager.js'
import { userRepo } from '../repositories/userRepository.js'
import { sessionManager } from './sessionManager.js'

export type AccountAuthErrorCode =
  | 'INVALID_USERNAME'
  | 'USERNAME_TAKEN'
  | 'PASSWORD_TOO_SHORT'
  | 'INVALID_PASSWORD'
  | 'INVALID_CREDENTIALS'
  | 'ALREADY_REGISTERED'
  | 'REGISTRATION_UNAVAILABLE'
  | 'USER_NOT_FOUND'

export class AccountAuthError extends Error {
  constructor(public readonly code: AccountAuthErrorCode) {
    super(code)
    this.name = 'AccountAuthError'
  }
}

export interface RegisterInput {
  username: string
  password: string
  nickname: string
}

export interface AuthResult {
  user: PersistedUser
  session: IssuedSession
}

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'root', 'system'])
const DUMMY_PASSWORD_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKxGhu4G6PBlEUl0HEofS8qvFZQ8nX3L4fC6u'

export function normalizeUsername(username: string): string {
  const normalized = username.trim()
  if (!USERNAME_PATTERN.test(normalized) || RESERVED_USERNAMES.has(normalized.toLowerCase())) {
    throw new AccountAuthError('INVALID_USERNAME')
  }
  return normalized
}

export function validateAccountPassword(password: string): void {
  if (password.length < 10) throw new AccountAuthError('PASSWORD_TOO_SHORT')
  if (password.length > 128) throw new AccountAuthError('INVALID_PASSWORD')
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed: users.username')
}

export function createAccountAuth(users: UserRepository, sessions: SessionManager, options: { bcryptRounds: number }) {
  return {
    createGuest(nickname: string, current?: { user: PersistedUser; session: PersistedSession }): AuthResult {
      const cleanNickname = nickname.trim()
      if (current?.user.kind === 'account') throw new AccountAuthError('ALREADY_REGISTERED')
      if (current?.user.kind === 'guest') {
        return users.transaction(() => {
          const user = users.updateProfile(current.user.id, { nickname: cleanNickname })!
          sessions.revoke(current.session.id)
          return { user, session: sessions.issue(user.id) }
        })
      }
      return users.transaction(() => {
        const user = users.create({
          id: randomUUID(),
          kind: 'guest',
          username: null,
          nickname: cleanNickname,
          passwordHash: null,
        })
        return { user, session: sessions.issue(user.id) }
      })
    },
    async register(input: RegisterInput, currentGuestSession?: PersistedSession): Promise<AuthResult> {
      if (users.countAdmins() === 0) throw new AccountAuthError('REGISTRATION_UNAVAILABLE')
      const username = normalizeUsername(input.username)
      validateAccountPassword(input.password)
      const passwordHash = await bcrypt.hash(input.password, options.bcryptRounds)
      try {
        return users.transaction(() => {
          let user: PersistedUser
          if (currentGuestSession) {
            const guest = users.get(currentGuestSession.userId)
            if (!guest || guest.kind !== 'guest') throw new AccountAuthError('ALREADY_REGISTERED')
            user = users.upgradeGuest(guest.id, { username, passwordHash, nickname: input.nickname.trim() })!
            sessions.revokeAllForUser(user.id)
          } else {
            user = users.create({
              id: randomUUID(),
              kind: 'account',
              username,
              nickname: input.nickname.trim(),
              passwordHash,
            })
          }
          return { user, session: sessions.issue(user.id) }
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new AccountAuthError('USERNAME_TAKEN')
        throw error
      }
    },
    async login(usernameInput: string, password: string, currentSessionId?: string): Promise<AuthResult> {
      const username = usernameInput.trim()
      const user = users.getByUsername(username)
      const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
      if (!user || user.kind !== 'account' || user.status !== 'active' || !passwordMatches) {
        throw new AccountAuthError('INVALID_CREDENTIALS')
      }
      if (currentSessionId) sessions.revoke(currentSessionId)
      return { user, session: sessions.issue(user.id) }
    },
    async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<AuthResult> {
      validateAccountPassword(newPassword)
      const user = users.get(userId)
      if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        throw new AccountAuthError('INVALID_CREDENTIALS')
      }
      const passwordHash = await bcrypt.hash(newPassword, options.bcryptRounds)
      return users.transaction(() => {
        if (!users.compareAndSetPasswordHash(userId, user.passwordHash!, passwordHash, false)) {
          throw new AccountAuthError('INVALID_CREDENTIALS')
        }
        sessions.revokeAllForUser(userId)
        return { user: users.get(userId)!, session: sessions.issue(userId) }
      })
    },
    async changeBootstrapCredentials(
      userId: string,
      newUsernameInput: string,
      newPassword: string,
    ): Promise<AuthResult> {
      const newUsername = normalizeUsername(newUsernameInput)
      validateAccountPassword(newPassword)
      const user = users.get(userId)
      if (
        !user?.passwordHash ||
        user.kind !== 'account' ||
        user.role !== 'admin' ||
        !user.mustChangeUsername ||
        !user.mustChangePassword
      ) {
        throw new AccountAuthError('INVALID_CREDENTIALS')
      }
      const passwordHash = await bcrypt.hash(newPassword, options.bcryptRounds)
      try {
        return users.transaction(() => {
          if (!users.compareAndSetCredentials(userId, user.passwordHash!, newUsername, passwordHash)) {
            throw new AccountAuthError('INVALID_CREDENTIALS')
          }
          sessions.revokeAllForUser(userId)
          return { user: users.get(userId)!, session: sessions.issue(userId) }
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new AccountAuthError('USERNAME_TAKEN')
        throw error
      }
    },
    async resetPasswordByAdmin(targetUserId: string, newPassword: string): Promise<void> {
      validateAccountPassword(newPassword)
      const target = users.get(targetUserId)
      if (!target || target.kind !== 'account') throw new AccountAuthError('USER_NOT_FOUND')
      const passwordHash = await bcrypt.hash(newPassword, options.bcryptRounds)
      users.transaction(() => {
        users.setPasswordHash(targetUserId, passwordHash, true)
        sessions.revokeAllForUser(targetUserId)
      })
    },
    logout(sessionId: string): void {
      sessions.revoke(sessionId)
    },
  }
}

export type AccountAuth = ReturnType<typeof createAccountAuth>
export const accountAuth = createAccountAuth(userRepo, sessionManager, { bcryptRounds: 12 })
