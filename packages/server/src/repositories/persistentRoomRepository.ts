import type { AudioQuality, PlayMode, SourcePriority, User, UserRole } from '@music-together/shared'
import { db } from './database.js'
import type { RoomData } from './types.js'
import { userRepo } from './userRepository.js'

interface RoomRow {
  id: string
  name: string
  creator_id: string
  password_hash: string | null
  hidden: 0 | 1
  permanent: 0 | 1
  settings_json: string
  created_at: number
  updated_at: number
  dissolved_at: number | null
}

interface RoomMemberRow {
  room_id: string
  user_id: string
  nickname_snapshot: string
  role: UserRole
  online: 0 | 1
  joined_at: number
  left_at: number | null
}

interface RoomSettingsJson {
  audioQuality?: AudioQuality
  sourcePriority?: SourcePriority
  playMode?: PlayMode
  adminUserIds?: string[]
  hiddenMemberUserIds?: string[]
  chatHistoryForNewUsers?: boolean
  unmServerUrl?: string
}

function normalizeSourcePriority(value: unknown): SourcePriority {
  switch (value) {
    case 'smart':
    case 'platform-first':
    case 'platform-only':
    case 'unm-first':
    case 'unm-only':
      return value
    default:
      return 'smart'
  }
}

const upsertRoomStmt = db.prepare(`
  INSERT INTO rooms (id, name, creator_id, password_hash, hidden, permanent, settings_json, created_at, updated_at, dissolved_at)
  VALUES (@id, @name, @creatorId, @password, @hidden, @permanent, @settingsJson, @now, @now, NULL)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    password_hash = excluded.password_hash,
    hidden = excluded.hidden,
    permanent = excluded.permanent,
    settings_json = excluded.settings_json,
    updated_at = excluded.updated_at,
    dissolved_at = NULL
`)

const upsertMemberStmt = db.prepare(`
  INSERT INTO room_members (room_id, user_id, nickname_snapshot, role, online, joined_at, left_at)
  VALUES (@roomId, @userId, @nickname, @role, @online, @now, @leftAt)
  ON CONFLICT(room_id, user_id) DO UPDATE SET
    nickname_snapshot = excluded.nickname_snapshot,
    role = excluded.role,
    online = excluded.online,
    left_at = excluded.left_at
`)

const loadRoomsStmt = db.prepare<[], RoomRow>(
  'SELECT * FROM rooms WHERE permanent = 1 AND dissolved_at IS NULL ORDER BY created_at ASC',
)
const loadMembersStmt = db.prepare<[string], RoomMemberRow>(
  'SELECT * FROM room_members WHERE room_id = ? ORDER BY joined_at ASC',
)
const markDissolvedStmt = db.prepare('UPDATE rooms SET dissolved_at = ?, updated_at = ? WHERE id = ?')

function roomSettings(room: RoomData): RoomSettingsJson {
  return {
    audioQuality: room.audioQuality,
    sourcePriority: room.sourcePriority,
    playMode: room.playMode,
    adminUserIds: Array.from(room.adminUserIds),
    hiddenMemberUserIds: Array.from(room.hiddenMemberUserIds),
    chatHistoryForNewUsers: room.chatHistoryForNewUsers,
    unmServerUrl: room.unmServerUrl,
  }
}

export const persistentRoomRepo = {
  saveRoom(room: RoomData): void {
    const now = Date.now()
    upsertRoomStmt.run({
      id: room.id,
      name: room.name,
      creatorId: room.creatorId,
      password: room.password,
      hidden: room.hidden ? 1 : 0,
      permanent: room.permanent ? 1 : 0,
      settingsJson: JSON.stringify(roomSettings(room)),
      now,
    })
  },

  saveMember(roomId: string, user: User): void {
    upsertMemberStmt.run({
      roomId,
      userId: user.id,
      nickname: user.nickname,
      role: user.role,
      online: user.online === false ? 0 : 1,
      leftAt: user.online === false ? Date.now() : null,
      now: Date.now(),
    })
  },

  save(room: RoomData): void {
    this.saveRoom(room)
    for (const user of room.users) this.saveMember(room.id, user)
  },

  markDissolved(roomId: string): void {
    const now = Date.now()
    markDissolvedStmt.run(now, now, roomId)
  },

  loadPermanentRooms(): RoomData[] {
    return loadRoomsStmt.all().map((row) => {
      const settings = JSON.parse(row.settings_json || '{}') as RoomSettingsJson
      const hiddenMemberUserIds = new Set(settings.hiddenMemberUserIds ?? [])
      const members = loadMembersStmt.all(row.id).filter((member) => !hiddenMemberUserIds.has(member.user_id))
      const users: User[] = members.map((member) => {
        const profile = userRepo.get(member.user_id)
        return {
          id: member.user_id,
          nickname: profile?.nickname || member.nickname_snapshot,
          avatarUrl: profile?.avatarUrl ?? null,
          role: member.role,
          online: false,
        }
      })

      return {
        id: row.id,
        name: row.name,
        password: row.password_hash,
        creatorId: row.creator_id,
        hostId: row.creator_id,
        adminUserIds: new Set(settings.adminUserIds ?? []),
        hiddenMemberUserIds,
        temporaryAdminUserId: null,
        audioQuality: settings.audioQuality ?? 320,
        sourcePriority: normalizeSourcePriority(settings.sourcePriority),
        hidden: Boolean(row.hidden),
        permanent: true,
        chatHistoryForNewUsers: settings.chatHistoryForNewUsers ?? true,
        users,
        queue: [],
        currentTrack: null,
        playState: {
          isPlaying: false,
          currentTime: 0,
          serverTimestamp: Date.now(),
        },
        playMode: settings.playMode ?? 'loop-all',
        unmServerUrl: settings.unmServerUrl ?? '',
      }
    })
  },
}
