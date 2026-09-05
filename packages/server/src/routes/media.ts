import Busboy from 'busboy'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Router, type Request, type Response, type Router as RouterType } from 'express'
import * as z from 'zod/v4'
import { roomRepo } from '../repositories/roomRepository.js'
import {
  MediaProcessingError,
  createMediaTempPath,
  deleteMediaForRoom,
  getAuthorizedMediaRecord,
  getMediaConfig,
  getMediaCoverPath,
  getMediaFilePath,
  getMediaLyrics,
  getMediaCookieStatus,
  importUploadedFile,
  importUrl,
  isRoomMediaMember,
  isRoomMediaOwner,
  removeMediaCookie,
  saveMediaCookie,
} from '../services/customMediaService.js'
import { mediaRepo } from '../repositories/mediaRepository.js'

const router: RouterType = Router()

const importSchema = z.object({
  url: z.string().trim().min(1).max(4000),
  title: z.string().trim().max(500).optional(),
  artist: z.union([z.string().trim().max(500), z.array(z.string().trim().max(200)).max(20)]).optional(),
  album: z.string().trim().max(500).optional(),
})

const cookieSchema = z.object({
  cookie: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024),
})

const roomIdPattern = /^[A-Za-z0-9_-]{1,20}$/

function param(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value
}

function validRoomId(roomId: string): boolean {
  return roomIdPattern.test(roomId)
}

function roomMember(req: Request, res: Response, roomId: string) {
  if (!validRoomId(roomId)) {
    res.status(400).json({ code: 'INVALID_ROOM', error: 'Invalid room ID' })
    return null
  }
  if (!roomRepo.get(roomId)) {
    res.status(404).json({ code: 'ROOM_NOT_FOUND', error: 'Room not found' })
    return null
  }
  if (!isRoomMediaMember(roomId, req.identityUserId)) {
    res
      .status(req.identityUserId ? 403 : 401)
      .json({ code: req.identityUserId ? 'NO_PERMISSION' : 'AUTH_REQUIRED', error: 'Room access required' })
    return null
  }
  return req.identityUserId!
}

function roomOwner(req: Request, res: Response, roomId: string): string | null {
  const userId = roomMember(req, res, roomId)
  if (!userId) return null
  if (!isRoomMediaOwner(roomId, userId)) {
    res.status(403).json({ code: 'NOT_OWNER', error: 'Only the room owner can manage media credentials' })
    return null
  }
  return userId
}

function sendMediaError(res: Response, error: unknown): void {
  if (error instanceof MediaProcessingError) {
    res.status(error.status).json({ code: error.code, error: error.message })
    return
  }
  res.status(500).json({ code: 'MEDIA_PROCESSING_FAILED', error: 'Media processing failed' })
}

interface MultipartFile {
  path: string
  filename: string
  mimeType: string
}

interface MultipartResult {
  fields: Record<string, string>
  file: MultipartFile | null
}

function parseMultipart(req: Request, maxFileBytes: number, fieldName = 'file'): Promise<MultipartResult> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fields: 10, parts: 12, fieldSize: 10_000, fileSize: maxFileBytes },
      })
    } catch {
      reject(new MediaProcessingError('Invalid multipart request', 'INVALID_MULTIPART', 400))
      return
    }

    const fields: Record<string, string> = {}
    let fileSeen = false
    let tempPath: string | null = null
    let settled = false
    let filePromise: Promise<MultipartFile | null> = Promise.resolve(null)

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      if (tempPath) void rm(tempPath, { force: true })
      reject(error)
    }

    parser.on('field', (name, value) => {
      if (Object.keys(fields).length < 10) fields[name] = value
    })
    parser.on('file', (name, stream, info) => {
      if (name !== fieldName || fileSeen) {
        stream.resume()
        return
      }
      fileSeen = true
      filePromise = (async () => {
        const createdPath = await createMediaTempPath('upload')
        if (settled) {
          stream.resume()
          await rm(createdPath, { force: true })
          return null
        }

        tempPath = createdPath
        const output = createWriteStream(createdPath, { mode: 0o600 })
        let truncated = false
        stream.once('limit', () => {
          truncated = true
        })
        await new Promise<void>((resolveFile, rejectFile) => {
          stream.once('error', rejectFile)
          output.once('error', rejectFile)
          output.once('finish', resolveFile)
          stream.pipe(output)
        })
        if (truncated) {
          throw new MediaProcessingError('音频文件超过大小限制', 'MEDIA_TOO_LARGE', 413)
        }
        return { path: createdPath, filename: info.filename || 'audio', mimeType: info.mimeType }
      })().catch((error) => {
        fail(error)
        return null
      })
    })
    parser.on('filesLimit', () => fail(new MediaProcessingError('一次只能上传一个文件', 'TOO_MANY_FILES', 400)))
    parser.on('partsLimit', () =>
      fail(new MediaProcessingError('Multipart request is too large', 'MULTIPART_TOO_LARGE', 400)),
    )
    parser.on('error', fail)
    parser.on('close', () => {
      if (settled) return
      void filePromise
        .then((file) => {
          if (settled) return
          settled = true
          resolve({ fields, file })
        })
        .catch(fail)
    })
    req.on('aborted', () => fail(new MediaProcessingError('上传已取消', 'UPLOAD_ABORTED', 400)))
    req.pipe(parser)
  })
}

function parseArtists(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined
  return value
    .split(/[;,/&、，]/)
    .map((artist) => artist.trim())
    .filter(Boolean)
    .slice(0, 20)
}

function withImportOptions(fields: Record<string, string>) {
  return {
    title: fields.title?.trim() || undefined,
    artist: parseArtists(fields.artist),
    album: fields.album?.trim() || undefined,
  }
}

router.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(getMediaConfig())
})

router.post('/rooms/:roomId/upload', async (req, res) => {
  const roomId = param(req.params.roomId)
  const userId = roomMember(req, res, roomId)
  if (!userId) return
  let multipart: MultipartResult
  try {
    multipart = await parseMultipart(req, getMediaConfig().maxUploadBytes)
    if (!multipart.file) throw new MediaProcessingError('请选择一个音频文件', 'MEDIA_FILE_REQUIRED', 400)
    const track = await importUploadedFile(
      roomId,
      userId,
      multipart.file.path,
      multipart.file.filename,
      multipart.file.mimeType,
      withImportOptions(multipart.fields),
    )
    res.status(201).json({ track })
  } catch (error) {
    sendMediaError(res, error)
  }
})

router.post('/rooms/:roomId/import', async (req, res) => {
  const roomId = param(req.params.roomId)
  const userId = roomMember(req, res, roomId)
  if (!userId) return
  const parsed = importSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_MEDIA_URL', error: parsed.error.issues[0]?.message ?? 'Invalid media URL' })
    return
  }
  try {
    const track = await importUrl(roomId, userId, parsed.data.url, {
      title: parsed.data.title,
      artist: typeof parsed.data.artist === 'string' ? parseArtists(parsed.data.artist) : parsed.data.artist,
      album: parsed.data.album,
    })
    res.status(201).json({ track })
  } catch (error) {
    sendMediaError(res, error)
  }
})

router.post('/rooms/:roomId/cookies/:platform', async (req, res) => {
  const roomId = param(req.params.roomId)
  const platform = param(req.params.platform)
  const userId = roomOwner(req, res, roomId)
  if (!userId) return
  if (platform !== 'youtube' && platform !== 'bilibili') {
    res.status(400).json({ code: 'INVALID_MEDIA_PLATFORM', error: 'Unsupported video platform' })
    return
  }
  try {
    const parsed = cookieSchema.safeParse(req.body)
    if (!parsed.success) throw new MediaProcessingError('请输入 Cookie 文本', 'COOKIE_REQUIRED', 400)
    saveMediaCookie(roomId, platform, userId, parsed.data.cookie)
    res.status(204).send()
  } catch (error) {
    sendMediaError(res, error)
  }
})

router.get('/rooms/:roomId/cookies', (req, res) => {
  const roomId = param(req.params.roomId)
  const userId = roomMember(req, res, roomId)
  if (!userId) return
  res.setHeader('Cache-Control', 'no-store')
  const youtube = getMediaCookieStatus(roomId, 'youtube')
  const bilibili = getMediaCookieStatus(roomId, 'bilibili')
  res.json({
    youtube: youtube.configured,
    bilibili: bilibili.configured,
    sources: { youtube: youtube.source, bilibili: bilibili.source },
  })
})

router.delete('/rooms/:roomId/cookies/:platform', (req, res) => {
  const roomId = param(req.params.roomId)
  const platform = param(req.params.platform)
  const userId = roomOwner(req, res, roomId)
  if (!userId) return
  if (platform !== 'youtube' && platform !== 'bilibili') {
    res.status(400).json({ code: 'INVALID_MEDIA_PLATFORM', error: 'Unsupported video platform' })
    return
  }
  removeMediaCookie(roomId, platform)
  res.status(204).send()
})

function authorizedRecord(req: Request, res: Response) {
  const mediaId = param(req.params.mediaId)
  const token = typeof req.query.token === 'string' ? req.query.token : undefined
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : undefined
  if (!roomId || !validRoomId(roomId)) {
    res.status(400).json({ code: 'INVALID_MEDIA_ACCESS', error: 'Missing room access' })
    return null
  }
  if (!req.identityUserId) {
    res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Room access required' })
    return null
  }
  if (!isRoomMediaMember(roomId, req.identityUserId)) {
    res.status(403).json({ code: 'NO_PERMISSION', error: 'Room access required' })
    return null
  }
  const record = getAuthorizedMediaRecord(mediaId, roomId, token)
  if (!record) {
    res.status(404).json({ code: 'MEDIA_NOT_FOUND', error: 'Media is not available' })
    return null
  }
  mediaRepo.touchAccess(mediaId)
  return record
}

router.get('/:mediaId/stream', async (req, res) => {
  const record = authorizedRecord(req, res)
  if (!record) return
  try {
    const filePath = getMediaFilePath(record)
    const fileInfo = await stat(filePath)
    const total = fileInfo.size
    const rangeHeader = req.headers.range
    res.setHeader('Content-Type', record.mimeType)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', 'private, no-store')
    if (!rangeHeader) {
      res.setHeader('Content-Length', String(total))
      createReadStream(filePath).pipe(res)
      return
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
    if (!match || total <= 0) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`).end()
      return
    }
    const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]))
    const end = match[1] ? Math.min(match[2] ? Number(match[2]) : total - 1, total - 1) : total - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= total) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`).end()
      return
    }
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
    res.setHeader('Content-Length', String(end - start + 1))
    createReadStream(filePath, { start, end }).pipe(res)
  } catch {
    if (!res.headersSent) res.status(404).json({ code: 'MEDIA_FILE_MISSING', error: 'Media file is missing' })
    else res.end()
  }
})

router.get('/:mediaId/cover', async (req, res) => {
  const record = authorizedRecord(req, res)
  if (!record || !record.coverPath) {
    if (record && !res.headersSent)
      res.status(404).json({ code: 'MEDIA_COVER_MISSING', error: 'Media cover is missing' })
    return
  }
  try {
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    createReadStream(getMediaCoverPath(record)).pipe(res)
  } catch {
    if (!res.headersSent) res.status(404).json({ code: 'MEDIA_COVER_MISSING', error: 'Media cover is missing' })
  }
})

router.get('/:mediaId/lyrics', (req, res) => {
  const record = authorizedRecord(req, res)
  if (!record) return
  res.setHeader('Cache-Control', 'private, no-store')
  res.json(getMediaLyrics(record))
})

router.delete('/rooms/:roomId/:mediaId', async (req, res) => {
  const roomId = param(req.params.roomId)
  const mediaId = param(req.params.mediaId)
  const userId = roomMember(req, res, roomId)
  if (!userId) return
  const record = mediaRepo.get(mediaId)
  if (!record || record.roomId !== roomId) {
    res.status(404).json({ code: 'MEDIA_NOT_FOUND', error: 'Media is not available' })
    return
  }
  if (!isRoomMediaOwner(roomId, userId) && record.createdByUserId !== userId) {
    res.status(403).json({ code: 'NO_PERMISSION', error: 'You cannot delete this media' })
    return
  }
  if (record.status === 'ready') {
    for (const room of roomRepo.getAll().values()) {
      if (room.currentTrack?.mediaId === record.id || room.queue.some((track) => track.mediaId === record.id)) {
        res.status(409).json({ code: 'MEDIA_IN_USE', error: 'Media is still in the queue or playing' })
        return
      }
    }
  }
  await deleteMediaForRoom(mediaId, roomId)
  res.status(204).send()
})

export default router
