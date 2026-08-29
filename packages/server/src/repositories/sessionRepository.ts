import type { Database } from 'better-sqlite3'
import { db } from './database.js'

export interface PersistedSession {
  id: string
  userId: string
  tokenHash: string
  createdAt: number
  expiresAt: number
  lastSeenAt: number
  revokedAt: number | null
}

interface SessionRow {
  id: string
  user_id: string
  token_hash: string
  created_at: number
  expires_at: number
  last_seen_at: number
  revoked_at: number | null
}

function toSession(row: SessionRow): PersistedSession {
  return { id: row.id, userId: row.user_id, tokenHash: row.token_hash, createdAt: row.created_at, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at }
}

export function createSessionRepository(database: Database) {
  const insert = database.prepare(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`)
  const selectByHash = database.prepare<string, SessionRow>('SELECT * FROM sessions WHERE token_hash = ?')
  const revoke = database.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
  const revokeAll = database.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
  const revokeAllExcept = database.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL')
  const touch = database.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
  return {
    create(session: PersistedSession): void {
      insert.run(session.id, session.userId, session.tokenHash, session.createdAt, session.expiresAt, session.lastSeenAt)
    },
    getByTokenHash(tokenHash: string): PersistedSession | null {
      const row = selectByHash.get(tokenHash)
      return row ? toSession(row) : null
    },
    revoke(sessionId: string, now = Date.now()): void { revoke.run(now, sessionId) },
    revokeAllForUser(userId: string, now = Date.now()): void { revokeAll.run(now, userId) },
    revokeAllExcept(userId: string, sessionId: string, now = Date.now()): void { revokeAllExcept.run(now, userId, sessionId) },
    touch(sessionId: string, now = Date.now()): void { touch.run(now, sessionId) },
  }
}

export type SessionRepository = ReturnType<typeof createSessionRepository>
export const sessionRepo = createSessionRepository(db)
