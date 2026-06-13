import type { MusicSource } from '@music-together/shared'
import { db } from './database.js'

export interface PersistedPlatformAuth {
  roomId: string
  userId: string
  platform: MusicSource
  cookie: string
  nickname: string
  vipType: number
  persistPolicy: 'room' | 'server'
}

interface PlatformAuthRow {
  user_id: string
  room_id: string | null
  platform: MusicSource
  cookie_encrypted: string
  persist_policy: 'room' | 'server'
  nickname_snapshot: string | null
  vip_type: number | null
}

interface TableColumn {
  name: string
}

function ensureColumn(name: string, ddl: string): void {
  const columns = db.prepare<[], TableColumn>('PRAGMA table_info(platform_auth)').all()
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE platform_auth ADD COLUMN ${ddl}`)
  }
}

ensureColumn('nickname_snapshot', 'nickname_snapshot TEXT')
ensureColumn('vip_type', 'vip_type INTEGER NOT NULL DEFAULT 0')

const upsertStmt = db.prepare(`
  INSERT INTO platform_auth (
    id,
    user_id,
    room_id,
    platform,
    cookie_encrypted,
    persist_policy,
    nickname_snapshot,
    vip_type,
    created_at,
    updated_at
  )
  VALUES (@id, @userId, @roomId, @platform, @cookie, @persistPolicy, @nickname, @vipType, @now, @now)
  ON CONFLICT(id) DO UPDATE SET
    cookie_encrypted = excluded.cookie_encrypted,
    persist_policy = excluded.persist_policy,
    nickname_snapshot = excluded.nickname_snapshot,
    vip_type = excluded.vip_type,
    updated_at = excluded.updated_at
`)

const deleteStmt = db.prepare('DELETE FROM platform_auth WHERE room_id = ? AND platform = ? AND user_id = ?')
const deleteRoomStmt = db.prepare("DELETE FROM platform_auth WHERE room_id = ? AND persist_policy = 'room'")
const loadRoomStmt = db.prepare<[string], PlatformAuthRow>('SELECT * FROM platform_auth WHERE room_id = ?')

function authId(roomId: string, platform: MusicSource, userId: string): string {
  return `${roomId}:${platform}:${userId}`
}

export const platformAuthRepo = {
  save(entry: PersistedPlatformAuth): void {
    upsertStmt.run({
      id: authId(entry.roomId, entry.platform, entry.userId),
      userId: entry.userId,
      roomId: entry.roomId,
      platform: entry.platform,
      cookie: entry.cookie,
      persistPolicy: entry.persistPolicy,
      nickname: entry.nickname,
      vipType: entry.vipType,
      now: Date.now(),
    })
  },

  remove(roomId: string, platform: MusicSource, userId: string): void {
    deleteStmt.run(roomId, platform, userId)
  },

  cleanupRoom(roomId: string): void {
    deleteRoomStmt.run(roomId)
  },

  loadRoom(roomId: string): PersistedPlatformAuth[] {
    return loadRoomStmt.all(roomId).map((row) => ({
      roomId: row.room_id ?? roomId,
      userId: row.user_id,
      platform: row.platform,
      cookie: row.cookie_encrypted,
      nickname: row.nickname_snapshot ?? row.user_id,
      vipType: row.vip_type ?? 0,
      persistPolicy: row.persist_policy,
    }))
  },
}
