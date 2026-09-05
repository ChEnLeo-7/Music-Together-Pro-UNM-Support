import type { CustomMediaOrigin, Track } from '@music-together/shared'
import { db } from './database.js'
import { decryptMediaCredential, encryptMediaCredential } from '../services/platformAuthCredentialService.js'
import { createRoomMediaToken } from '../utils/mediaToken.js'

export type MediaStatus = 'processing' | 'ready' | 'failed' | 'deleted'
export type MediaCookiePlatform = 'youtube' | 'bilibili'

export interface MediaRecord {
  id: string
  roomId: string
  createdByUserId: string
  origin: CustomMediaOrigin
  status: MediaStatus
  storagePath: string | null
  coverPath: string | null
  sourceUrl: string | null
  mimeType: string
  byteSize: number
  sha256: string | null
  title: string
  artist: string[]
  album: string
  durationSeconds: number
  lyricsText: string | null
  translatedLyricsText: string | null
  lyricSource: string | null
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
  lastReferencedAt: number
  lastAccessedAt: number | null
  failedAt: number | null
  deletedAt: number | null
}

interface MediaRow {
  id: string
  room_id: string
  created_by_user_id: string
  origin: CustomMediaOrigin
  status: MediaStatus
  storage_path: string | null
  cover_path: string | null
  source_url: string | null
  mime_type: string
  byte_size: number
  sha256: string | null
  title: string
  artist_json: string
  album: string
  duration_seconds: number
  lyrics_text: string | null
  translated_lyrics_text: string | null
  lyric_source: string | null
  metadata_json: string
  created_at: number
  updated_at: number
  last_referenced_at: number
  last_accessed_at: number | null
  failed_at: number | null
  deleted_at: number | null
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function fromRow(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    createdByUserId: row.created_by_user_id,
    origin: row.origin,
    status: row.status,
    storagePath: row.storage_path,
    coverPath: row.cover_path,
    sourceUrl: row.source_url,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    title: row.title,
    artist: parseJson<string[]>(row.artist_json, []),
    album: row.album,
    durationSeconds: row.duration_seconds,
    lyricsText: row.lyrics_text,
    translatedLyricsText: row.translated_lyrics_text,
    lyricSource: row.lyric_source,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastReferencedAt: row.last_referenced_at,
    lastAccessedAt: row.last_accessed_at,
    failedAt: row.failed_at,
    deletedAt: row.deleted_at,
  }
}

const selectById = db.prepare<[string], MediaRow>('SELECT * FROM room_media WHERE id = ?')
const selectByRoom = db.prepare<[string], MediaRow>(
  "SELECT * FROM room_media WHERE room_id = ? AND status <> 'deleted' ORDER BY created_at DESC",
)
const insertMedia = db.prepare(`
  INSERT INTO room_media (
    id, room_id, created_by_user_id, origin, status, source_url, mime_type,
    created_at, updated_at, last_referenced_at
  ) VALUES (@id, @roomId, @createdByUserId, @origin, 'processing', @sourceUrl, @mimeType, @now, @now, @now)
`)
const markReady = db.prepare(`
  UPDATE room_media SET
    status = 'ready', storage_path = @storagePath, cover_path = @coverPath,
    mime_type = @mimeType, byte_size = @byteSize, sha256 = @sha256,
    title = @title, artist_json = @artistJson, album = @album,
    duration_seconds = @durationSeconds, lyrics_text = @lyricsText,
    translated_lyrics_text = @translatedLyricsText, lyric_source = @lyricSource,
    metadata_json = @metadataJson, updated_at = @now, last_referenced_at = @now,
    failed_at = NULL, deleted_at = NULL
  WHERE id = @id AND status = 'processing'
`)
const markFailed = db.prepare(`
  UPDATE room_media SET status = 'failed', updated_at = @now, failed_at = @now, metadata_json = @metadataJson
  WHERE id = @id
`)
const touchReference = db.prepare(
  'UPDATE room_media SET last_referenced_at = ?, updated_at = ? WHERE id = ? AND status = \'ready\'',
)
const touchAccess = db.prepare(
  'UPDATE room_media SET last_accessed_at = ?, updated_at = ? WHERE id = ? AND status = \'ready\'',
)
const selectCleanupCandidates = db.prepare<[number, number], MediaRow>(`
  SELECT * FROM room_media
  WHERE status = 'ready'
    AND last_referenced_at < ?
    AND (last_accessed_at IS NULL OR last_accessed_at < ?)
  ORDER BY updated_at ASC
`)
const claimForDeletion = db.prepare(
  "UPDATE room_media SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND status = 'ready'",
)
const deleteByRoom = db.prepare('DELETE FROM room_media WHERE room_id = ?')
const deleteMedia = db.prepare('DELETE FROM room_media WHERE id = ?')
const saveCookie = db.prepare(`
  INSERT INTO room_media_credentials (room_id, platform, cookie_encrypted, created_by_user_id, created_at, updated_at)
  VALUES (@roomId, @platform, @cookie, @userId, @now, @now)
  ON CONFLICT(room_id, platform) DO UPDATE SET
    cookie_encrypted = excluded.cookie_encrypted,
    created_by_user_id = excluded.created_by_user_id,
    updated_at = excluded.updated_at
`)
const getCookie = db.prepare<[string, MediaCookiePlatform], { cookie_encrypted: string } | undefined>(
  'SELECT cookie_encrypted FROM room_media_credentials WHERE room_id = ? AND platform = ?',
)
const hasCookie = db.prepare<[string, MediaCookiePlatform], { present: number }>(
  'SELECT 1 AS present FROM room_media_credentials WHERE room_id = ? AND platform = ?',
)
const deleteCookie = db.prepare<[string, MediaCookiePlatform]>(
  'DELETE FROM room_media_credentials WHERE room_id = ? AND platform = ?',
)
const deleteRoomCookies = db.prepare<[string]>('DELETE FROM room_media_credentials WHERE room_id = ?')
const roomByteSize = db.prepare<[string], { total: number }>(
  "SELECT COALESCE(SUM(byte_size), 0) AS total FROM room_media WHERE room_id = ? AND status <> 'deleted'",
)
const totalByteSize = db.prepare<[], { total: number }>(
  "SELECT COALESCE(SUM(byte_size), 0) AS total FROM room_media WHERE status <> 'deleted'",
)

export const mediaRepo = {
  createProcessing(input: {
    id: string
    roomId: string
    createdByUserId: string
    origin: CustomMediaOrigin
    sourceUrl?: string
    mimeType?: string
  }): MediaRecord {
    const now = Date.now()
    insertMedia.run({
      ...input,
      sourceUrl: input.sourceUrl ?? null,
      mimeType: input.mimeType ?? 'application/octet-stream',
      now,
    })
    return fromRow(selectById.get(input.id)!)
  },

  markReady(input: {
    id: string
    storagePath: string
    coverPath?: string | null
    mimeType: string
    byteSize: number
    sha256: string
    title: string
    artist: string[]
    album: string
    durationSeconds: number
    lyricsText?: string | null
    translatedLyricsText?: string | null
    lyricSource?: string | null
    metadata?: Record<string, unknown>
  }): MediaRecord | undefined {
    markReady.run({
      ...input,
      coverPath: input.coverPath ?? null,
      lyricsText: input.lyricsText ?? null,
      translatedLyricsText: input.translatedLyricsText ?? null,
      lyricSource: input.lyricSource ?? null,
      artistJson: JSON.stringify(input.artist),
      metadataJson: JSON.stringify(input.metadata ?? {}),
      now: Date.now(),
    })
    const row = selectById.get(input.id)
    return row ? fromRow(row) : undefined
  },

  markFailed(id: string, message: string): void {
    markFailed.run({ id, now: Date.now(), metadataJson: JSON.stringify({ error: message.slice(0, 500) }) })
  },

  get(id: string): MediaRecord | undefined {
    const row = selectById.get(id)
    return row ? fromRow(row) : undefined
  },

  listByRoom(roomId: string): MediaRecord[] {
    return selectByRoom.all(roomId).map(fromRow)
  },

  touchReference(id: string, at = Date.now()): void {
    touchReference.run(at, at, id)
  },

  touchAccess(id: string, at = Date.now()): void {
    touchAccess.run(at, at, id)
  },

  cleanupCandidates(referenceBefore: number, accessBefore: number): MediaRecord[] {
    return selectCleanupCandidates.all(referenceBefore, accessBefore).map(fromRow)
  },

  claimForDeletion(id: string, at = Date.now()): boolean {
    return claimForDeletion.run(at, at, id).changes === 1
  },

  deleteByRoom(roomId: string): void {
    deleteByRoom.run(roomId)
    deleteRoomCookies.run(roomId)
  },

  deleteMedia(id: string): void {
    deleteMedia.run(id)
  },

  saveCookie(roomId: string, platform: MediaCookiePlatform, userId: string, cookie: string): void {
    const now = Date.now()
    saveCookie.run({ roomId, platform, userId, cookie: encryptMediaCredential(cookie), now })
  },

  getCookie(roomId: string, platform: MediaCookiePlatform): string | null {
    const row = getCookie.get(roomId, platform)
    if (!row) return null
    try {
      return decryptMediaCredential(row.cookie_encrypted)
    } catch {
      deleteCookie.run(roomId, platform)
      return null
    }
  },

  hasCookie(roomId: string, platform: MediaCookiePlatform): boolean {
    return Boolean(hasCookie.get(roomId, platform)?.present)
  },

  deleteCookie(roomId: string, platform: MediaCookiePlatform): void {
    deleteCookie.run(roomId, platform)
  },

  getRoomByteSize(roomId: string): number {
    return roomByteSize.get(roomId)?.total ?? 0
  },

  getTotalByteSize(): number {
    return totalByteSize.get()?.total ?? 0
  },
}

export function customTrackFromMedia(record: MediaRecord, roomId?: string, streamUrl?: string): Track {
  const token = roomId ? createRoomMediaToken(record.id, roomId) : null
  const tokenQuery = token
    ? `?roomId=${encodeURIComponent(roomId!)}&token=${encodeURIComponent(token)}`
    : ''
  return {
    id: `custom:${record.id}`,
    kind: 'custom',
    source: 'custom',
    sourceId: record.id,
    urlId: record.id,
    mediaId: record.id,
    mediaOrigin: record.origin,
    mimeType: record.mimeType,
    title: record.title,
    artist: record.artist,
    album: record.album,
    duration: record.durationSeconds,
    cover: record.coverPath ? `/api/media/${encodeURIComponent(record.id)}/cover${tokenQuery}` : '',
    lyricsUrl: record.lyricsText ? `/api/media/${encodeURIComponent(record.id)}/lyrics${tokenQuery}` : undefined,
    streamUrl: streamUrl ?? (token ? `/api/media/${encodeURIComponent(record.id)}/stream${tokenQuery}` : undefined),
    streamSource: 'custom',
  }
}

export function isCustomTrack(track: Track): track is Track & { source: 'custom' } {
  return track.source === 'custom'
}
