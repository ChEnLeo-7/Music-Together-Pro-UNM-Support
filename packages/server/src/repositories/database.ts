import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import { runMigrations } from './migrations.js'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'

export function resolveDatabasePath(databaseUrl: string): string {
  if (databaseUrl === ':memory:' || databaseUrl === 'file::memory:') return ':memory:'
  if (databaseUrl.startsWith('file:')) {
    const rawPath = databaseUrl.slice('file:'.length)
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath)
  }
  return path.isAbsolute(databaseUrl) ? databaseUrl : path.resolve(process.cwd(), databaseUrl)
}

const dbPath = resolveDatabasePath(config.database.url)
mkdirSync(path.dirname(dbPath), { recursive: true })

export const db: BetterSqliteDatabase = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
runMigrations(db)
const adminCount = db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get()?.count ?? 0
if (adminCount === 0) {
  const now = Date.now()
  db.prepare(`
    INSERT INTO users (
      id, kind, username, nickname, avatar_url, password_hash, role, status,
      must_change_password, must_change_username, created_at, updated_at, last_seen_at
    ) VALUES (?, 'account', 'admin', 'admin', NULL, ?, 'admin', 'active', 1, 1, ?, ?, ?)
  `).run(randomUUID(), bcrypt.hashSync('admin', 12), now, now, now)
  logger.warn('Created bootstrap administrator admin/admin; credentials must be changed at first login')
}

export const databasePath = dbPath
