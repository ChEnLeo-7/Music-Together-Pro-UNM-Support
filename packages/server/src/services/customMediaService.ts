import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { parseFile, selectCover, type IAudioMetadata } from 'music-metadata'
import { fileTypeFromFile } from 'file-type'
import sharp from 'sharp'
import type { CustomMediaOrigin, Track, TrackSource } from '@music-together/shared'
import {
  mediaRepo,
  customTrackFromMedia,
  type MediaCookiePlatform,
  type MediaRecord,
} from '../repositories/mediaRepository.js'
import { config } from '../config.js'
import { assertPublicHttpUrl } from '../utils/publicUrl.js'
import { createRoomMediaToken, verifyRoomMediaToken } from '../utils/mediaToken.js'
import { logger } from '../utils/logger.js'
import { musicProvider } from './musicProvider.js'
import { roomRepo } from '../repositories/roomRepository.js'

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/flac',
  'audio/x-flac',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/webm',
  'video/mp4',
])
const ALLOWED_VIDEO_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'bilibili.com',
  'www.bilibili.com',
  'm.bilibili.com',
  'b23.tv',
])
const TRUSTED_THUMBNAIL_HOSTS = [
  'hdslb.com',
  'biliimg.com',
  'ytimg.com',
  'ggpht.com',
  'y.gtimg.cn',
  'music.126.net',
  'imgessl.kugou.com',
] as const
const MAX_TEXT_LENGTH = 500
const MAX_LYRICS_LENGTH = 200_000

export class MediaProcessingError extends Error {
  constructor(
    message: string,
    readonly code = 'MEDIA_PROCESSING_FAILED',
    readonly status = 400,
  ) {
    super(message)
    this.name = 'MediaProcessingError'
  }
}

export interface MediaImportOptions {
  title?: string
  artist?: string[]
  album?: string
}

function safeText(value: unknown, fallback = '', maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') return fallback
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength)
}

function safeLyrics(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, MAX_LYRICS_LENGTH)
  return cleaned || null
}

function safeArtists(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[;,/&、，]/) : []
  const artists = values
    .map((item) => safeText(item))
    .filter(Boolean)
    .slice(0, 20)
  return artists.length > 0 ? artists : ['未知艺术家']
}

function safeFileName(fileName: string): string {
  const base = path
    .basename(fileName)
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .trim()
  return base || 'audio'
}

function parseFileName(fileName: string): { title: string; artist: string[] } {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '').trim()
  const separator = withoutExtension.indexOf(' - ')
  if (separator > 0) {
    const artist = safeArtists(withoutExtension.slice(0, separator))
    return { title: safeText(withoutExtension.slice(separator + 3), '未知歌曲'), artist }
  }
  return { title: safeText(withoutExtension, '未知歌曲'), artist: ['未知艺术家'] }
}

function mediaDirectory(mediaId: string): string {
  return path.join(config.media.root, mediaId)
}

function assertInsideMediaRoot(filePath: string): string {
  const root = path.resolve(config.media.root)
  const resolved = path.resolve(filePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new MediaProcessingError('Invalid media path', 'INVALID_MEDIA_PATH', 500)
  }
  return resolved
}

async function ensureMediaDirectory(mediaId: string): Promise<string> {
  const directory = mediaDirectory(mediaId)
  await mkdir(assertInsideMediaRoot(directory), { recursive: true, mode: 0o700 })
  return directory
}

async function removeMediaDirectory(mediaId: string): Promise<void> {
  await rm(assertInsideMediaRoot(mediaDirectory(mediaId)), { recursive: true, force: true })
}

async function checkQuota(roomId: string, incomingBytes: number): Promise<void> {
  if (mediaRepo.getRoomByteSize(roomId) + incomingBytes > config.media.maxRoomBytes) {
    throw new MediaProcessingError('房间媒体存储空间已满', 'MEDIA_ROOM_QUOTA_EXCEEDED', 413)
  }
  if (mediaRepo.getTotalByteSize() + incomingBytes > config.media.maxTotalBytes) {
    throw new MediaProcessingError('服务器媒体存储空间已满', 'MEDIA_SERVER_QUOTA_EXCEEDED', 413)
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function validateAudioFile(filePath: string, declaredMime?: string): Promise<string> {
  const detected = await fileTypeFromFile(filePath)
  const mime = detected?.mime ?? declaredMime?.split(';')[0]?.trim().toLowerCase()
  if (!mime || !ALLOWED_AUDIO_MIMES.has(mime)) {
    throw new MediaProcessingError('仅支持常用音频格式（MP3、FLAC、M4A、OGG、WAV）', 'UNSUPPORTED_AUDIO_FORMAT', 415)
  }
  if (mime === 'audio/mp3') return 'audio/mpeg'
  if (mime === 'video/mp4') return 'audio/mp4'
  return mime
}

async function extractMetadata(
  filePath: string,
  originalName: string,
  options: MediaImportOptions,
): Promise<{
  title: string
  artist: string[]
  album: string
  durationSeconds: number
  lyricsText: string | null
  translatedLyricsText: string | null
  cover: Uint8Array | null
  coverMime: string | null
  parser: IAudioMetadata
}> {
  let parser: IAudioMetadata
  try {
    parser = await parseFile(filePath, { duration: true })
  } catch {
    throw new MediaProcessingError('无法读取音频文件或文件已损坏', 'INVALID_AUDIO_FILE', 400)
  }
  if (parser.format.hasVideo) {
    throw new MediaProcessingError('不支持上传视频文件，请使用视频链接导入', 'VIDEO_FILE_NOT_SUPPORTED', 415)
  }
  const fallback = parseFileName(originalName)
  const common = parser.common
  const duration = parser.format.duration ?? 0
  if (!Number.isFinite(duration) || duration <= 0 || duration > config.media.maxDurationSeconds) {
    throw new MediaProcessingError('音频时长无效或超过服务器限制', 'AUDIO_DURATION_INVALID', 400)
  }
  const lyrics = safeLyrics(
    common.lyrics?.map((item) => item.text || item.syncText?.map((line) => line.text).join('\n') || '').join('\n'),
  )
  const artist = options.artist?.length
    ? safeArtists(options.artist)
    : safeArtists(common.artists ?? common.artist ?? fallback.artist)
  return {
    title: safeText(options.title, safeText(common.title, fallback.title)),
    artist,
    album: safeText(options.album, safeText(common.album)),
    durationSeconds: Math.round(duration * 1000) / 1000,
    lyricsText: lyrics,
    translatedLyricsText: null,
    cover: selectCover(common.picture)?.data ?? null,
    coverMime: selectCover(common.picture)?.format ?? null,
    parser,
  }
}

async function storeCover(mediaId: string, cover: Uint8Array | null): Promise<string | null> {
  if (!cover || cover.byteLength === 0) return null
  const output = assertInsideMediaRoot(path.join(mediaDirectory(mediaId), 'cover.webp'))
  try {
    await sharp(Buffer.from(cover), { failOn: 'error' })
      .resize(1200, 1200)
      .webp({ quality: 86 })
      .toBuffer()
      .then((buffer) => writeFile(output, buffer, { mode: 0o600 }))
    return output
  } catch {
    return null
  }
}

async function downloadRemoteFile(
  url: string,
  destination: string,
  maxBytes: number,
): Promise<{ mime: string; size: number }> {
  const parsed = await assertPublicHttpUrl(url)
  const response = await fetch(parsed, {
    redirect: 'error',
    signal: AbortSignal.timeout(config.media.jobTimeoutMs),
    headers: { 'User-Agent': 'MusicTogether/1.0' },
  })
  if (!response.ok || !response.body)
    throw new MediaProcessingError('无法下载远程音频文件', 'REMOTE_MEDIA_UNAVAILABLE', 422)
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > maxBytes) throw new MediaProcessingError('远程音频文件超过大小限制', 'MEDIA_TOO_LARGE', 413)
  let size = 0
  const output = createWriteStream(destination, { mode: 0o600 })
  const outputError = new Promise<never>((_, reject) => {
    output.once('error', reject)
  })
  try {
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) throw new MediaProcessingError('远程音频文件超过大小限制', 'MEDIA_TOO_LARGE', 413)
        if (!output.write(Buffer.from(value))) {
          await Promise.race([new Promise<void>((resolve) => output.once('drain', resolve)), outputError])
        }
      }
    } finally {
      reader.releaseLock()
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        output.once('finish', resolve)
        output.end()
      }),
      outputError,
    ])
  } catch (error) {
    output.destroy()
    throw error
  }
  const mime =
    (await fileTypeFromFile(destination))?.mime ?? response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  return { mime, size }
}

function isVideoImportUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase()
    return [...ALLOWED_VIDEO_HOSTS].some((host) => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

async function runYtDlp(
  url: string,
  destination: string,
  cookiePath: string | null,
): Promise<{ title?: string; artist?: string; album?: string; thumbnail?: string }> {
  const parsed = new URL(url)
  if (
    !ALLOWED_VIDEO_HOSTS.has(parsed.hostname.toLowerCase()) &&
    ![...ALLOWED_VIDEO_HOSTS].some((host) => parsed.hostname.endsWith(`.${host}`))
  ) {
    throw new MediaProcessingError('仅支持 Bilibili 和 YouTube 链接', 'VIDEO_HOST_NOT_SUPPORTED', 422)
  }
  const outputTemplate = `${destination}.%(ext)s`
  const args = [
    '--no-playlist',
    '--no-part',
    '--no-warnings',
    '--no-progress',
    '--max-filesize',
    `${Math.floor(config.media.maxUploadBytes / 1024 / 1024)}M`,
    '--match-filter',
    `duration <= ${config.media.maxDurationSeconds}`,
    '--format',
    'bestaudio/best',
    '--extract-audio',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0',
    '--output',
    outputTemplate,
    '--print-json',
  ]
  // A bare `ffmpeg` uses PATH. Passing it to --ffmpeg-location makes yt-dlp
  // treat it as a directory and prevents discovery of ffprobe beside it.
  if (config.media.ffmpegPath && config.media.ffmpegPath !== 'ffmpeg') {
    args.splice(args.indexOf('--output'), 0, '--ffmpeg-location', config.media.ffmpegPath)
  }
  if (cookiePath) args.push('--cookies', cookiePath)
  args.push(url)

  return new Promise((resolve, reject) => {
    const child = spawn(config.media.ytdlpPath, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
      reject(new MediaProcessingError('视频提取超时', 'VIDEO_EXTRACTION_TIMEOUT', 504))
    }, config.media.jobTimeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(-100_000)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-10_000)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new MediaProcessingError('服务器未安装 yt-dlp，请联系管理员', 'YTDLP_NOT_INSTALLED', 503))
      } else reject(new MediaProcessingError('视频提取失败', 'VIDEO_EXTRACTION_FAILED', 422))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        logger.warn('yt-dlp extraction failed', { code, detail: stderr.replace(/\s+/g, ' ').slice(-300) })
        reject(
          new MediaProcessingError('视频无法提取为音频，可能需要登录或受到平台限制', 'VIDEO_EXTRACTION_FAILED', 422),
        )
        return
      }
      const metadataLine = stdout
        .split(/\r?\n/)
        .reverse()
        .find((line) => line.trim().startsWith('{'))
      try {
        const metadata = metadataLine ? (JSON.parse(metadataLine) as Record<string, unknown>) : {}
        resolve({
          title: safeText(metadata.title),
          artist: safeText(metadata.artist ?? metadata.uploader),
          album: safeText(metadata.album),
          thumbnail: safeText(metadata.thumbnail),
        })
      } catch {
        resolve({})
      }
    })
  })
}

async function findExtractedAudio(destination: string): Promise<string> {
  const directory = path.dirname(destination)
  const prefix = path.basename(destination)
  const entries = await (await import('node:fs/promises')).readdir(directory)
  const match = entries.find((entry) => entry.startsWith(`${prefix}.`) && !entry.endsWith('.part'))
  if (!match) throw new MediaProcessingError('视频提取未生成音频文件', 'VIDEO_AUDIO_MISSING', 422)
  return path.join(directory, match)
}

async function downloadThumbnail(mediaId: string, thumbnail: string | undefined): Promise<string | null> {
  if (!thumbnail) return null
  try {
    const parsed = await assertPublicHttpUrl(thumbnail, { allowFakeIpForHosts: TRUSTED_THUMBNAIL_HOSTS })
    const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > 10 * 1024 * 1024) return null
    return storeCover(mediaId, buffer)
  } catch (error) {
    let hostname = 'unknown'
    try {
      hostname = new URL(thumbnail).hostname
    } catch {
      /* The URL validator reports malformed thumbnail URLs. */
    }
    logger.warn('Failed to download media thumbnail', { mediaId, hostname, detail: String(error) })
    return null
  }
}

async function enrichMetadata(
  title: string,
  artist: string[],
  album: string,
  durationSeconds: number,
): Promise<{
  coverUrl: string
  lyricsText: string | null
  translatedLyricsText: string | null
  provider?: TrackSource
  sourceId?: string
  confidence: number
}> {
  const keyword = `${title} ${artist.join(' ')}`.trim()
  if (!keyword) return { coverUrl: '', lyricsText: null, translatedLyricsText: null, confidence: 0 }
  const candidates = await Promise.all(
    (['netease', 'tencent', 'kugou'] as const).map(async (source) => {
      try {
        const tracks = await musicProvider.search(source, keyword, 5, 1)
        return tracks.map((track) => ({ source, track }))
      } catch {
        return []
      }
    }),
  )
  const flattened = candidates.flat()
  const normalize = (value: string) => value.toLowerCase().replace(/[\s\-_'"“”‘’()[\]（）【】]/g, '')
  const targetTitle = normalize(title)
  const targetArtists = new Set(artist.map(normalize).filter(Boolean))
  const scored = flattened
    .map(({ source, track }) => {
      const candidateTitle = normalize(track.title)
      const titleScore =
        candidateTitle === targetTitle
          ? 1
          : candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)
            ? 0.75
            : 0
      const artistScore = track.artist.some((item) => targetArtists.has(normalize(item))) ? 1 : 0
      const albumScore = album && track.album && normalize(album) === normalize(track.album) ? 0.2 : 0
      const durationScore =
        durationSeconds > 0 && track.duration > 0
          ? Math.max(0, 1 - Math.abs(track.duration - durationSeconds) / 30) * 0.2
          : 0
      return { source, track, score: titleScore * 0.55 + artistScore * 0.25 + albumScore + durationScore }
    })
    .sort((a, b) => b.score - a.score)[0]
  if (!scored || scored.score < 0.72)
    return { coverUrl: '', lyricsText: null, translatedLyricsText: null, confidence: scored?.score ?? 0 }
  let lyricsText: string | null = null
  let translatedLyricsText: string | null = null
  if (scored.track.lyricId) {
    try {
      const lyrics = await musicProvider.getLyric(scored.source, scored.track.lyricId)
      lyricsText = safeLyrics(lyrics.lyric)
      translatedLyricsText = safeLyrics(lyrics.tlyric)
    } catch {
      /* Metadata enrichment is best effort. */
    }
  }
  return {
    coverUrl: scored.track.cover,
    lyricsText,
    translatedLyricsText,
    provider: scored.source,
    sourceId: scored.track.sourceId,
    confidence: scored.score,
  }
}

async function processMediaFile(
  record: MediaRecord,
  sourceFile: string,
  originalName: string,
  declaredMime: string | undefined,
  options: MediaImportOptions,
  thumbnail?: string,
): Promise<MediaRecord> {
  const mediaDir = await ensureMediaDirectory(record.id)
  const mimeType = await validateAudioFile(sourceFile, declaredMime)
  const fileInfo = await stat(sourceFile)
  if (fileInfo.size > config.media.maxUploadBytes) {
    throw new MediaProcessingError('音频文件超过大小限制', 'MEDIA_TOO_LARGE', 413)
  }
  await checkQuota(record.roomId, fileInfo.size)
  const metadata = await extractMetadata(sourceFile, originalName, options)
  const audioPath = assertInsideMediaRoot(path.join(mediaDir, 'audio'))
  await rename(sourceFile, audioPath)
  let coverPath = await storeCover(record.id, metadata.cover)
  if (!coverPath) coverPath = await downloadThumbnail(record.id, thumbnail)
  let lyricsText = metadata.lyricsText
  let translatedLyricsText = metadata.translatedLyricsText
  let enrichment: Awaited<ReturnType<typeof enrichMetadata>> | null = null
  if (!coverPath || !lyricsText) {
    enrichment = await enrichMetadata(metadata.title, metadata.artist, metadata.album, metadata.durationSeconds)
    if (!coverPath && enrichment.coverUrl) {
      coverPath = await downloadThumbnail(record.id, enrichment.coverUrl)
    }
    if (!lyricsText) lyricsText = enrichment.lyricsText
    if (!translatedLyricsText) translatedLyricsText = enrichment.translatedLyricsText
  }
  const ready = mediaRepo.markReady({
    id: record.id,
    storagePath: audioPath,
    coverPath,
    mimeType,
    byteSize: fileInfo.size,
    sha256: await sha256File(audioPath),
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    durationSeconds: metadata.durationSeconds,
    lyricsText,
    translatedLyricsText,
    lyricSource: metadata.lyricsText ? 'embedded' : (enrichment?.provider ?? null),
    metadata: {
      originalName: safeFileName(originalName),
      container: metadata.parser.format.container,
      bitrate: metadata.parser.format.bitrate,
      enrichmentConfidence: enrichment?.confidence ?? 0,
      enrichmentSource: enrichment?.provider,
    },
  })
  if (!ready) throw new MediaProcessingError('媒体处理状态无效', 'MEDIA_STATE_INVALID', 500)
  return ready
}

async function withMediaRecord<T>(
  roomId: string,
  userId: string,
  origin: CustomMediaOrigin,
  sourceUrl: string | undefined,
  operation: (record: MediaRecord) => Promise<T>,
): Promise<T> {
  const id = randomUUID()
  const record = mediaRepo.createProcessing({ id, roomId, createdByUserId: userId, origin, sourceUrl })
  try {
    return await operation(record)
  } catch (error) {
    mediaRepo.markFailed(id, error instanceof Error ? error.message : 'media processing failed')
    await removeMediaDirectory(id).catch(() => undefined)
    throw error
  }
}

export async function importUploadedFile(
  roomId: string,
  userId: string,
  tempPath: string,
  originalName: string,
  declaredMime: string | undefined,
  options: MediaImportOptions = {},
): Promise<Track> {
  try {
    return await withMediaRecord(roomId, userId, 'upload', undefined, async (record) => {
      const ready = await processMediaFile(record, tempPath, originalName, declaredMime, options)
      return customTrackFromMedia(ready, roomId)
    })
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

export async function importUrl(
  roomId: string,
  userId: string,
  rawUrl: string,
  options: MediaImportOptions = {},
): Promise<Track> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new MediaProcessingError('请输入有效的 URL', 'INVALID_MEDIA_URL', 400)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new MediaProcessingError('仅支持不带账号密码的 HTTP(S) URL', 'INVALID_MEDIA_URL', 400)
  }
  const origin: CustomMediaOrigin = isVideoImportUrl(parsed.toString()) ? 'yt-dlp' : 'direct-url'
  return withMediaRecord(roomId, userId, origin, parsed.toString(), async (record) => {
    const tempDir = await mkdir(path.join(config.media.root, 'tmp'), { recursive: true, mode: 0o700 }).then(() =>
      path.join(config.media.root, 'tmp'),
    )
    const tempBase = assertInsideMediaRoot(path.join(tempDir, `${record.id}.source`))
    let sourceFile = tempBase
    try {
      let videoMetadata: Awaited<ReturnType<typeof runYtDlp>> = {}
      if (origin === 'yt-dlp') {
        const cookiePath = await createYtDlpCookieFile(
          roomId,
          parsed.hostname.toLowerCase().includes('bilibili') ? 'bilibili' : 'youtube',
        )
        try {
          videoMetadata = await runYtDlp(parsed.toString(), tempBase, cookiePath)
        } finally {
          if (cookiePath) await rm(cookiePath, { force: true }).catch(() => undefined)
        }
        sourceFile = await findExtractedAudio(tempBase)
      } else {
        await downloadRemoteFile(parsed.toString(), tempBase, config.media.maxUploadBytes)
      }
      const mergedOptions: MediaImportOptions = {
        ...options,
        title: options.title || videoMetadata.title,
        artist: options.artist?.length ? options.artist : videoMetadata.artist ? [videoMetadata.artist] : undefined,
        album: options.album || videoMetadata.album,
      }
      const ready = await processMediaFile(
        record,
        sourceFile,
        videoMetadata.title || parsed.pathname.split('/').pop() || 'remote-audio',
        undefined,
        mergedOptions,
        videoMetadata.thumbnail,
      )
      return customTrackFromMedia(ready, roomId)
    } finally {
      await rm(tempBase, { force: true }).catch(() => undefined)
      if (sourceFile !== tempBase) await rm(sourceFile, { force: true }).catch(() => undefined)
    }
  })
}

async function createYtDlpCookieFile(roomId: string, platform: MediaCookiePlatform): Promise<string | null> {
  const cookie = getEffectiveMediaCookie(roomId, platform)
  if (!cookie) return null
  const directory = assertInsideMediaRoot(path.join(config.media.root, 'tmp'))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const filePath = assertInsideMediaRoot(path.join(directory, `cookies-${randomUUID()}.txt`))
  await writeFile(filePath, cookie, { encoding: 'utf8', mode: 0o600 })
  await chmod(filePath, 0o600)
  return filePath
}

export function resolveMediaCookie(
  roomCookie: string | null,
  environmentCookie: string | null,
  platform: MediaCookiePlatform,
): string | null {
  const cookie = roomCookie || environmentCookie
  return cookie ? normalizeMediaCookie(cookie, platform) : null
}

export function getEffectiveMediaCookie(roomId: string, platform: MediaCookiePlatform): string | null {
  const environmentCookie = platform === 'youtube' ? config.media.youtubeCookie : config.media.bilibiliCookie
  return resolveMediaCookie(mediaRepo.getCookie(roomId, platform), environmentCookie, platform)
}

export function getMediaCookieStatus(
  roomId: string,
  platform: MediaCookiePlatform,
): {
  configured: boolean
  source: 'room' | 'environment' | null
} {
  if (mediaRepo.hasCookie(roomId, platform)) return { configured: true, source: 'room' }
  const environmentCookie = platform === 'youtube' ? config.media.youtubeCookie : config.media.bilibiliCookie
  return environmentCookie ? { configured: true, source: 'environment' } : { configured: false, source: null }
}

export function getMediaRecord(mediaId: string): MediaRecord | undefined {
  return mediaRepo.get(mediaId)
}

export function getAuthorizedMediaRecord(
  mediaId: string,
  roomId: string,
  token: string | undefined,
): MediaRecord | undefined {
  const record = mediaRepo.get(mediaId)
  if (!record || record.roomId !== roomId || record.status !== 'ready' || !token) return undefined
  return verifyRoomMediaToken(token, mediaId, roomId) ? record : undefined
}

export function getMediaFilePath(record: MediaRecord): string {
  if (!record.storagePath) throw new MediaProcessingError('媒体文件不存在', 'MEDIA_FILE_MISSING', 404)
  return assertInsideMediaRoot(record.storagePath)
}

export function getMediaCoverPath(record: MediaRecord): string {
  if (!record.coverPath) throw new MediaProcessingError('媒体封面不存在', 'MEDIA_COVER_MISSING', 404)
  return assertInsideMediaRoot(record.coverPath)
}

export async function createMediaTempPath(suffix = 'upload'): Promise<string> {
  const directory = assertInsideMediaRoot(path.join(config.media.root, 'tmp'))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return assertInsideMediaRoot(path.join(directory, `${randomUUID()}.${suffix}`))
}

export function getMediaConfig(): { maxUploadBytes: number; maxDurationSeconds: number } {
  return {
    maxUploadBytes: config.media.maxUploadBytes,
    maxDurationSeconds: config.media.maxDurationSeconds,
  }
}

export async function canonicalizeTrackForRoom(roomId: string, track: Track): Promise<Track | null> {
  if (track.source !== 'custom') return track
  const mediaId = track.mediaId || track.sourceId
  const record = mediaRepo.get(mediaId)
  if (!record || record.roomId !== roomId || record.status !== 'ready' || !record.storagePath) return null
  try {
    await stat(getMediaFilePath(record))
  } catch {
    return null
  }
  return {
    ...customTrackFromMedia(record, roomId),
    requestedBy: track.requestedBy,
  }
}

export function getMediaLyrics(record: MediaRecord): { lyric: string; tlyric: string; romalrc: string; yrc: string } {
  return {
    lyric: record.lyricsText ?? '',
    tlyric: record.translatedLyricsText ?? '',
    romalrc: '',
    yrc: '',
  }
}

export function isRoomMediaMember(roomId: string, userId: string | undefined): boolean {
  if (!userId) return false
  const room = roomRepo.get(roomId)
  return Boolean(room?.users.some((user) => user.id === userId && user.online !== false))
}

export function isRoomMediaOwner(roomId: string, userId: string | undefined): boolean {
  if (!userId) return false
  const room = roomRepo.get(roomId)
  return room?.creatorId === userId && isRoomMediaMember(roomId, userId)
}

export function getMediaRoomId(mediaId: string): string | null {
  return mediaRepo.get(mediaId)?.roomId ?? null
}

export function getMediaRecordForRoom(mediaId: string, roomId: string): MediaRecord | undefined {
  const record = mediaRepo.get(mediaId)
  return record?.roomId === roomId ? record : undefined
}

export function getMediaRecordStoragePath(record: MediaRecord): string {
  return getMediaFilePath(record)
}

export function getMediaRecordCoverPath(record: MediaRecord): string {
  return getMediaCoverPath(record)
}

export function getMediaRecordLyrics(record: MediaRecord): {
  lyric: string
  tlyric: string
  romalrc: string
  yrc: string
} {
  return getMediaLyrics(record)
}

export function getMediaRecordToken(mediaId: string, roomId: string): string {
  return createRoomMediaToken(mediaId, roomId)
}

export function verifyMediaAccessToken(token: string, mediaId: string, roomId: string): boolean {
  return verifyRoomMediaToken(token, mediaId, roomId)
}

export function getMediaRecordWithAccess(
  mediaId: string,
  roomId: string,
  token: string | undefined,
): MediaRecord | undefined {
  const record = getAuthorizedMediaRecord(mediaId, roomId, token)
  if (!record) return undefined
  return record
}

export async function deleteMediaForRoom(mediaId: string, roomId: string): Promise<boolean> {
  const record = mediaRepo.get(mediaId)
  if (!record || record.roomId !== roomId) return false
  await removeMediaDirectory(record.id).catch(() => undefined)
  mediaRepo.deleteMedia(record.id)
  return true
}

export function markMediaReferenced(track: Track): void {
  if (track.source === 'custom' && track.mediaId) mediaRepo.touchReference(track.mediaId)
}

export function isMediaReferenced(mediaId: string): boolean {
  for (const room of roomRepo.getAll().values()) {
    if (room.currentTrack?.source === 'custom' && room.currentTrack.mediaId === mediaId) return true
    if (room.queue.some((track) => track.source === 'custom' && track.mediaId === mediaId)) return true
  }
  return false
}

export async function cleanupInactiveMedia(): Promise<void> {
  const before = Date.now() - config.media.inactivityMs
  for (const record of mediaRepo.cleanupCandidates(before, before)) {
    if (isMediaReferenced(record.id)) {
      mediaRepo.touchReference(record.id)
      continue
    }
    if (!mediaRepo.claimForDeletion(record.id)) continue
    await removeMediaDirectory(record.id).catch((error) =>
      logger.warn('Failed to remove custom media files', { mediaId: record.id, error: String(error) }),
    )
  }
}

let mediaCleanupTimer: ReturnType<typeof setInterval> | null = null

export function startMediaCleanup(): void {
  if (mediaCleanupTimer) return
  mediaCleanupTimer = setInterval(() => {
    cleanupInactiveMedia().catch((error) => logger.warn('Custom media cleanup failed', { error: String(error) }))
  }, config.media.cleanupIntervalMs)
  mediaCleanupTimer.unref()
}

export function stopMediaCleanup(): void {
  if (!mediaCleanupTimer) return
  clearInterval(mediaCleanupTimer)
  mediaCleanupTimer = null
}

export async function cleanupRoomMedia(roomId: string): Promise<void> {
  for (const record of mediaRepo.listByRoom(roomId)) await removeMediaDirectory(record.id).catch(() => undefined)
  mediaRepo.deleteByRoom(roomId)
}

export function saveMediaCookie(roomId: string, platform: MediaCookiePlatform, userId: string, cookie: string): void {
  cookie = normalizeMediaCookie(cookie, platform)
  mediaRepo.saveCookie(roomId, platform, userId, cookie)
}

export function normalizeMediaCookie(cookie: string, platform: MediaCookiePlatform): string {
  const trimmed = cookie.trim()
  if (!trimmed) throw new MediaProcessingError('Cookie 不能为空', 'INVALID_COOKIE_FILE', 400)
  if (trimmed.length > 2 * 1024 * 1024) throw new MediaProcessingError('Cookie 文本过大', 'COOKIE_TOO_LARGE', 413)
  const isNetscape =
    /^# Netscape HTTP Cookie File/im.test(trimmed) ||
    trimmed.split(/\r?\n/).some((line) => line.split('\t').length >= 7)
  if (isNetscape) return trimmed

  const header = trimmed.replace(/^cookie:\s*/i, '')
  const pairs = header
    .split(/[;\r\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=')
      if (separator <= 0) return null
      const name = part.slice(0, separator).trim()
      const value = part.slice(separator + 1).trim()
      return /^[A-Za-z0-9_%-]+$/.test(name) && !/[\u0000-\u001f\u007f]/.test(value) ? { name, value } : null
    })
    .filter((pair): pair is { name: string; value: string } => pair !== null)

  if (pairs.length === 0) {
    throw new MediaProcessingError('请输入 Cookie 字符串或 Netscape cookies.txt 内容', 'INVALID_COOKIE_FILE', 400)
  }

  const domain = platform === 'youtube' ? '.youtube.com' : '.bilibili.com'
  return [
    '# Netscape HTTP Cookie File',
    '# Generated from manually entered Cookie text.',
    ...pairs.map(({ name, value }) => `${domain}\tTRUE\t/\tTRUE\t0\t${name}\t${value}`),
  ].join('\n')
}

export function removeMediaCookie(roomId: string, platform: MediaCookiePlatform): void {
  mediaRepo.deleteCookie(roomId, platform)
}

export function mediaTrackForRoom(record: MediaRecord, roomId: string): Track {
  return customTrackFromMedia(record, roomId)
}
