import type { Database } from 'better-sqlite3'
import { db } from './database.js'

export type UserKind = 'guest' | 'account'
export type ServerUserRole = 'user' | 'admin'
export type UserStatus = 'active' | 'disabled'

export interface PersistedUser {
  id: string
  kind: UserKind
  username: string | null
  nickname: string
  avatarUrl: string | null
  passwordHash: string | null
  role: ServerUserRole
  status: UserStatus
  mustChangePassword: boolean
  mustChangeUsername: boolean
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}

interface UserRow {
  id: string
  kind: UserKind
  username: string | null
  nickname: string
  avatar_url: string | null
  password_hash: string | null
  role: ServerUserRole
  status: UserStatus
  must_change_password: 0 | 1
  must_change_username: 0 | 1
  created_at: number
  updated_at: number
  last_seen_at: number
}

function toUser(row: UserRow): PersistedUser {
  return {
    id: row.id,
    kind: row.kind,
    username: row.username,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    mustChangeUsername: Boolean(row.must_change_username),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  }
}

export function createUserRepository(database: Database) {
  const selectById = database.prepare<string, UserRow>('SELECT * FROM users WHERE id = ?')
  const selectByUsername = database.prepare<string, UserRow>('SELECT * FROM users WHERE username = ? COLLATE BINARY')
  const insert = database.prepare(`
    INSERT INTO users (id, kind, username, nickname, avatar_url, password_hash, role, status, must_change_password, must_change_username, created_at, updated_at, last_seen_at)
    VALUES (@id, @kind, @username, @nickname, NULL, @passwordHash, @role, 'active', @mustChangePassword, @mustChangeUsername, @now, @now, @now)
  `)
  const touch = database.prepare('UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?')
  const updateProfile = database.prepare('UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?')
  const upgradeGuest = database.prepare(`
    UPDATE users SET kind = 'account', username = ?, password_hash = ?, nickname = ?, updated_at = ?
    WHERE id = ? AND kind = 'guest'
  `)
  const updatePassword = database.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ? AND kind = 'account'
  `)
  const compareAndUpdatePassword = database.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ?
    WHERE id = ? AND kind = 'account' AND password_hash = ?
  `)
  const compareAndUpdateCredentials = database.prepare(`
    UPDATE users
    SET username = ?, password_hash = ?, must_change_username = 0, must_change_password = 0, updated_at = ?
    WHERE id = ? AND kind = 'account' AND password_hash = ?
  `)
  const deleteUser = database.prepare('DELETE FROM users WHERE id = ?')
  const listUsers = database.prepare<[], UserRow>('SELECT * FROM users ORDER BY created_at DESC')
  const countAdmins = database.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")

  return {
    get(userId: string): PersistedUser | null {
      const row = selectById.get(userId)
      return row ? toUser(row) : null
    },
    getByUsername(username: string): PersistedUser | null {
      const row = selectByUsername.get(username)
      return row ? toUser(row) : null
    },
    create(input: { id: string; kind: UserKind; username: string | null; nickname: string; passwordHash: string | null; role?: ServerUserRole; mustChangePassword?: boolean; mustChangeUsername?: boolean }): PersistedUser {
      insert.run({ ...input, role: input.role ?? 'user', mustChangePassword: input.mustChangePassword ? 1 : 0, mustChangeUsername: input.mustChangeUsername ? 1 : 0, now: Date.now() })
      return this.get(input.id)!
    },
    ensure(userId: string, defaults?: { nickname?: string }): PersistedUser {
      const existing = this.get(userId)
      if (!existing) throw new Error(`Authenticated user ${userId} does not exist`)
      const now = Date.now()
      touch.run(now, now, userId)
      if (defaults?.nickname?.trim() && defaults.nickname.trim() !== existing.nickname) {
        return this.updateProfile(userId, { nickname: defaults.nickname.trim() })!
      }
      return this.get(userId)!
    },
    touch(userId: string, now = Date.now()): void {
      touch.run(now, now, userId)
    },
    upgradeGuest(userId: string, input: { username: string; passwordHash: string; nickname: string }): PersistedUser | null {
      const result = upgradeGuest.run(input.username, input.passwordHash, input.nickname, Date.now(), userId)
      return result.changes === 1 ? this.get(userId) : null
    },
    updateProfile(userId: string, data: { nickname?: string; avatarUrl?: string | null }): PersistedUser | null {
      updateProfile.run(data.nickname ?? null, data.avatarUrl ?? null, Date.now(), userId)
      return this.get(userId)
    },
    setPasswordHash(userId: string, passwordHash: string, mustChangePassword = false): boolean {
      return updatePassword.run(passwordHash, mustChangePassword ? 1 : 0, Date.now(), userId).changes === 1
    },
    compareAndSetPasswordHash(userId: string, expectedHash: string, passwordHash: string, mustChangePassword = false): boolean {
      return compareAndUpdatePassword.run(passwordHash, mustChangePassword ? 1 : 0, Date.now(), userId, expectedHash).changes === 1
    },
    compareAndSetCredentials(userId: string, expectedHash: string, username: string, passwordHash: string): boolean {
      return compareAndUpdateCredentials.run(username, passwordHash, Date.now(), userId, expectedHash).changes === 1
    },
    list(): PersistedUser[] {
      return listUsers.all().map(toUser)
    },
    delete(userId: string): boolean {
      const user = this.get(userId)
      if (!user) return false
      if (user.role === 'admin' && this.countAdmins() <= 1) throw new Error('LAST_ADMIN')
      return deleteUser.run(userId).changes === 1
    },
    countAdmins(): number {
      return countAdmins.get()?.count ?? 0
    },
    isServerAdmin(userId: string): boolean {
      const user = this.get(userId)
      return user?.role === 'admin' && user.status === 'active'
    },
    transaction<T>(operation: () => T): T {
      return database.transaction(operation)()
    },
  }
}

export type UserRepository = ReturnType<typeof createUserRepository>
export const userRepo = createUserRepository(db)
