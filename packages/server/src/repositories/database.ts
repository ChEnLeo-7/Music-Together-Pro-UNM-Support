import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

function resolveDatabasePath(databaseUrl: string): string {
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

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_auth (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    room_id TEXT,
    platform TEXT NOT NULL,
    cookie_encrypted TEXT NOT NULL,
    persist_policy TEXT NOT NULL DEFAULT 'room',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    password_hash TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    permanent INTEGER NOT NULL DEFAULT 0,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    dissolved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    nickname_snapshot TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member',
    online INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    left_at INTEGER,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`)

export const databasePath = dbPath
