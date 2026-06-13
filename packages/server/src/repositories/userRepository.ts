import { db } from './database.js'
import { config } from '../config.js'

export type ServerUserRole = 'user' | 'admin'

export interface PersistedUser {
  id: string
  nickname: string
  avatarUrl: string | null
  passwordHash: string | null
  role: ServerUserRole
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}

interface UserRow {
  id: string
  nickname: string
  avatar_url: string | null
  password_hash: string | null
  role: ServerUserRole
  created_at: number
  updated_at: number
  last_seen_at: number
}

function toUser(row: UserRow): PersistedUser {
  return {
    id: row.id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  }
}

const selectUser = db.prepare<string, UserRow>('SELECT * FROM users WHERE id = ?')
const insertUser = db.prepare(`
  INSERT INTO users (id, nickname, avatar_url, password_hash, role, created_at, updated_at, last_seen_at)
  VALUES (@id, @nickname, @avatarUrl, @passwordHash, @role, @now, @now, @now)
`)
const touchUser = db.prepare('UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?')
const updateProfile = db.prepare('UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?')
const setPasswordHash = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?')
const listUsersStmt = db.prepare<[], UserRow>('SELECT * FROM users ORDER BY created_at DESC')

export const userRepo = {
  get(userId: string): PersistedUser | null {
    const row = selectUser.get(userId)
    return row ? toUser(row) : null
  },

  ensure(userId: string, defaults?: { nickname?: string }): PersistedUser {
    const existing = this.get(userId)
    const now = Date.now()
    if (existing) {
      touchUser.run(now, now, userId)
      const maybePromote = config.serverAdminIds.has(userId) && existing.role !== 'admin'
      if (maybePromote) {
        db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run('admin', now, userId)
        return this.get(userId)!
      }
      return existing
    }

    insertUser.run({
      id: userId,
      nickname: defaults?.nickname ?? '',
      avatarUrl: null,
      passwordHash: null,
      role: config.serverAdminIds.has(userId) ? 'admin' : 'user',
      now,
    })
    return this.get(userId)!
  },

  updateProfile(userId: string, data: { nickname?: string; avatarUrl?: string | null }): PersistedUser | null {
    updateProfile.run(data.nickname ?? null, data.avatarUrl ?? null, Date.now(), userId)
    return this.get(userId)
  },

  setPasswordHash(userId: string, passwordHash: string): void {
    setPasswordHash.run(passwordHash, Date.now(), userId)
  },

  list(): PersistedUser[] {
    return listUsersStmt.all().map(toUser)
  },

  delete(userId: string): void {
    deleteUserStmt.run(userId)
  },

  isServerAdmin(userId: string): boolean {
    if (config.serverAdminIds.has(userId)) return true
    return this.get(userId)?.role === 'admin'
  },
}
