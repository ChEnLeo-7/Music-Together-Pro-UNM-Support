import {
  searchQuerySchema,
  urlQuerySchema,
  lyricQuerySchema,
  coverQuerySchema,
  playlistQuerySchema,
} from '@music-together/shared'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import type { ZodSchema } from 'zod'
import { musicProvider } from '../services/musicProvider.js'
import * as authService from '../services/authService.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { logger } from '../utils/logger.js'
import { verifyStreamProxySignature } from '../utils/streamProxy.js'
import { getUnmServerTimeoutMs, getUnmServerUrl } from '../services/runtimeConfigService.js'
import { request as httpRequest } from 'node:http'

const router: RouterType = Router()
const STREAM_FETCH_TIMEOUT_MS = 120_000

interface ContentRange {
  start: number
  end: number
  total: number
}

interface ByteRange {
  start: number
  end: number
}

function parseContentRange(value: string | null): ContentRange | null {
  if (!value) return null
  const match = value.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i)
  if (!match) return null
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: Number(match[3]),
  }
}

function resolveByteRange(range: string, total: number): ByteRange | null {
  const match = range.match(/^bytes=(\d*)-(\d*)$/i)
  if (!match || total <= 0) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    const start = Math.max(0, total - suffixLength)
    return { start, end: total - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : total - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) return null
  return { start, end: Math.min(end, total - 1) }
}

function getExplicitRangeStart(range: string): number | null {
  const match = range.match(/^bytes=(\d+)-\d*$/i)
  if (!match) return null
  const start = Number(match[1])
  return Number.isFinite(start) ? start : null
}

function upstreamRangeMatchesRequest(range: string | undefined, upstream: globalThis.Response): boolean {
  if (!range) return true
  const requestedStart = getExplicitRangeStart(range)
  if (requestedStart === null) return false
  const contentRange = parseContentRange(upstream.headers.get('content-range'))
  return upstream.status === 206 && contentRange?.start === requestedStart
}

function setStreamHeaders(
  res: Response,
  upstreamHeaders: Headers,
  targetUrl: URL,
  overrides: { contentLength?: number; contentRange?: string; status?: number } = {},
): void {
  const passthroughHeaders = ['content-type', 'etag', 'last-modified']
  for (const header of passthroughHeaders) {
    const value = upstreamHeaders.get(header)
    if (value) res.setHeader(header, value)
  }

  if (targetUrl.pathname.toLowerCase().endsWith('.mp4')) {
    res.setHeader('Content-Type', 'audio/mp4')
  }
  res.setHeader('Accept-Ranges', 'bytes')
  if (overrides.contentRange) res.setHeader('Content-Range', overrides.contentRange)
  if (overrides.contentLength !== undefined) res.setHeader('Content-Length', String(overrides.contentLength))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.status(overrides.status ?? 200)
}

async function pipeSlicedWebStream(body: ReadableStream<Uint8Array>, res: Response, start: number, end: number): Promise<void> {
  const reader = body.getReader()
  let offset = 0
  try {
    while (offset <= end) {
      const { done, value } = await reader.read()
      if (done) break

      const chunkStart = offset
      const chunkEnd = offset + value.byteLength - 1
      offset += value.byteLength

      if (chunkEnd < start) continue
      const from = Math.max(0, start - chunkStart)
      const to = Math.min(value.byteLength, end - chunkStart + 1)
      if (to <= from) continue

      if (!res.write(Buffer.from(value.subarray(from, to)))) {
        await new Promise<void>((resolve) => res.once('drain', resolve))
      }
    }
    res.end()
  } finally {
    reader.releaseLock()
  }
}

/**
 * Wrap an async route handler with validation + error handling.
 * Eliminates repeated try/catch + Zod boilerplate in each route.
 */
function validated<T>(
  schema: ZodSchema<T>,
  label: string,
  handler: (data: T, req: Request, res: Response) => Promise<void>,
) {
  return async (req: Request, res: Response) => {
    try {
      const parsed = schema.safeParse(req.query)
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query parameters' })
        return
      }
      await handler(parsed.data, req, res)
    } catch (err) {
      logger.error(`${label} failed`, err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

router.get(
  '/search',
  validated(searchQuerySchema, 'Search', async (data, _req, res) => {
    const { source, keyword, limit: pageSize, page: pageNum, type } = data
    if (pageNum === 1) {
      if (type === 'song') {
        const directTrack = await musicProvider.getSongById(source, keyword)
        if (directTrack) {
          res.json({ tracks: [directTrack], page: pageNum, hasMore: false, direct: true })
          return
        }
      } else {
        const directCollection = await musicProvider.getCollectionById(source, keyword, type)
        if (directCollection) {
          res.json({ tracks: [directCollection], page: pageNum, hasMore: false, direct: true })
          return
        }
      }
    }

    if (type === 'album') {
      const albums = await musicProvider.searchAlbum(source, keyword, pageSize, pageNum)
      res.json({ tracks: albums, page: pageNum, hasMore: albums.length >= pageSize })
    } else if (type === 'playlist') {
      const playlists = await musicProvider.searchPlaylist(source, keyword, pageSize, pageNum)
      res.json({ tracks: playlists, page: pageNum, hasMore: playlists.length >= pageSize })
    } else {
      const tracks = await musicProvider.search(source, keyword, pageSize, pageNum)
      res.json({ tracks, page: pageNum, hasMore: tracks.length >= pageSize })
    }
  }),
)

router.get(
  '/url',
  validated(urlQuerySchema, 'Get stream URL', async (data, _req, res) => {
    const { source, urlId, bitrate } = data
    const result = await musicProvider.getStreamUrl(source, urlId, bitrate)
    res.json({ url: result?.url ?? null, streamSource: result?.source ?? null })
  }),
)

router.get(
  '/lyric',
  validated(lyricQuerySchema, 'Get lyric', async (data, _req, res) => {
    const { source, lyricId } = data
    const result = await musicProvider.getLyric(source, lyricId)
    res.json(result)
  }),
)

router.get(
  '/cover',
  validated(coverQuerySchema, 'Get cover', async (data, _req, res) => {
    const { source, picId, size } = data
    const url = await musicProvider.getCover(source, picId, size)
    res.json({ url })
  }),
)

router.get(
  '/playlist',
  validated(playlistQuerySchema, 'Get playlist', async (data, _req, res) => {
    const { source, id, limit, offset, total, roomId, type } = data

    let cookie: string | null = null
    if (roomId) {
      const identityUserId = _req.identityUserId
      if (!identityUserId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      const room = roomRepo.get(roomId)
      if (!room || !room.users.some((u) => u.id === identityUserId)) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
      cookie = authService.getUserCookie(identityUserId, source, roomId)
    }

    const result = await musicProvider.getPlaylistPage(source, id, limit, offset, total, cookie, type)
    res.json({ tracks: result.tracks, total: result.total, offset, hasMore: result.hasMore })
  }),
)

// ---------------------------------------------------------------------------
// 封面图片代理 — 解决外部 CDN（如 QQ 音乐 y.gtimg.cn）的 CORS 限制
// AMLL 的 BackgroundRender 用 WebGL 纹理加载图片，需要同源或 CORS 允许
// ---------------------------------------------------------------------------
const ALLOWED_COVER_HOSTS = [
  'y.gtimg.cn',
  'p1.music.126.net',
  'p2.music.126.net',
  'p3.music.126.net',
  'p4.music.126.net',
  'imgessl.kugou.com',
]

router.get('/cover-proxy', async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string | undefined
  if (!imageUrl) {
    res.status(400).json({ error: 'Missing url parameter' })
    return
  }

  try {
    const parsed = new URL(imageUrl)
    if (!ALLOWED_COVER_HOSTS.includes(parsed.hostname)) {
      res.status(403).json({ error: 'Host not allowed' })
      return
    }

    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })

    if (!response.ok) {
      res.status(response.status).json({ error: 'Upstream fetch failed' })
      return
    }

    // 这里不要直接 pipe web stream。
    // 上游 CDN 超时/中断时，Readable 的异步 error 可能逃出当前 try/catch，导致 Node 进程崩溃。
    // 封面图体积小，直接读成 buffer 更稳，失败也会在当前 await 中被 catch。
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 透传 content-type，设置缓存（封面图不会频繁变化）
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(buffer.length))
    res.setHeader('Cache-Control', 'public, max-age=86400') // 24h 缓存
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(200).end(buffer)
  } catch (err) {
    logger.error('Cover proxy failed', err, { imageUrl })
    if (!res.headersSent) {
      res.status(504).json({ error: 'Cover proxy failed' })
    } else {
      res.end()
    }
  }
})

router.get('/stream-proxy', async (req: Request, res: Response) => {
  const audioUrl = req.query.url as string | undefined
  const sig = req.query.sig as string | undefined
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : undefined
  if (!audioUrl || !sig) {
    res.status(400).json({ error: 'Missing url or sig parameter' })
    return
  }

  if (!verifyStreamProxySignature(audioUrl, sig)) {
    res.status(403).json({ error: 'Invalid signature' })
    return
  }

  try {
    const parsed = new URL(audioUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'Unsupported protocol' })
      return
    }

    const upstreamHeaders: HeadersInit = {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://music.163.com/',
    }
    const range = req.headers.range
    if (range) upstreamHeaders.Range = range

    if (getUnmServerUrl(roomId) && parsed.hostname === 'music.163.com') {
      await proxyStreamViaUnm(audioUrl, upstreamHeaders, res, roomId)
      return
    }

    const upstream = await fetch(audioUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(STREAM_FETCH_TIMEOUT_MS),
    })

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).json({ error: 'Upstream stream fetch failed' })
      return
    }

    if (!upstream.body) {
      setStreamHeaders(res, upstream.headers, parsed, { status: upstream.status })
      res.end()
      return
    }

    if (range && !upstreamRangeMatchesRequest(range, upstream)) {
      const contentLength = Number(upstream.headers.get('content-length') ?? 0)
      const contentRange = parseContentRange(upstream.headers.get('content-range'))
      const total = contentRange?.total ?? (Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0)
      const requestedRange = resolveByteRange(range, total)

      if (!requestedRange) {
        res.status(416)
        if (total > 0) res.setHeader('Content-Range', `bytes */${total}`)
        res.end()
        return
      }

      logger.warn('Upstream ignored or changed requested Range, slicing proxy response', {
        audioUrl,
        requestedRange: range,
        upstreamStatus: upstream.status,
        upstreamContentRange: upstream.headers.get('content-range'),
        upstreamContentLength: upstream.headers.get('content-length'),
      })

      setStreamHeaders(res, upstream.headers, parsed, {
        status: 206,
        contentLength: requestedRange.end - requestedRange.start + 1,
        contentRange: `bytes ${requestedRange.start}-${requestedRange.end}/${total}`,
      })
      await pipeSlicedWebStream(upstream.body, res, requestedRange.start, requestedRange.end)
      return
    }

    const upstreamContentLength = Number(upstream.headers.get('content-length') ?? 0)
    setStreamHeaders(res, upstream.headers, parsed, {
      status: upstream.status,
      contentLength: Number.isFinite(upstreamContentLength) && upstreamContentLength > 0 ? upstreamContentLength : undefined,
      contentRange: upstream.headers.get('content-range') ?? undefined,
    })

    const reader = upstream.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!res.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => res.once('drain', resolve))
        }
      }
      res.end()
    } finally {
      reader.releaseLock()
    }
  } catch (err) {
    logger.error('Stream proxy failed', err, { audioUrl })
    if (!res.headersSent) {
      res.status(504).json({ error: 'Stream proxy failed' })
    } else {
      res.end()
    }
  }
})

async function proxyStreamViaUnm(audioUrl: string, headers: HeadersInit, res: Response, roomId?: string): Promise<void> {
  const proxyUrl = new URL(getUnmServerUrl(roomId))
  const targetUrl = new URL(audioUrl)
  logger.info('Proxying stream via UNM', { roomId, unmHost: proxyUrl.host, targetHost: targetUrl.host })

  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest(
      {
        host: proxyUrl.hostname,
        port: proxyUrl.port ? Number(proxyUrl.port) : 80,
        method: 'GET',
        path: targetUrl.toString(),
        headers: {
          ...Object.fromEntries(new Headers(headers).entries()),
          Host: targetUrl.host,
          Connection: 'close',
        },
        timeout: getUnmServerTimeoutMs(),
      },
      (upstreamRes) => {
        logger.info('UNM stream proxy response', { roomId, statusCode: upstreamRes.statusCode, contentType: upstreamRes.headers['content-type'] })
        const passthroughHeaders = [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'etag',
          'last-modified',
        ]
        for (const header of passthroughHeaders) {
          const value = upstreamRes.headers[header]
          if (typeof value === 'string') res.setHeader(header, value)
        }
        if (targetUrl.pathname.toLowerCase().endsWith('.mp4')) {
          res.setHeader('Content-Type', 'audio/mp4')
        }
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.status(upstreamRes.statusCode ?? 502)

        upstreamRes.on('data', (chunk) => {
          if (!res.write(chunk)) upstreamRes.pause()
        })
        res.on('drain', () => upstreamRes.resume())
        upstreamRes.on('end', () => {
          res.end()
          resolve()
        })
        upstreamRes.on('error', reject)
      },
    )

    upstream.on('timeout', () => {
      upstream.destroy(new Error('UNM stream proxy request timeout'))
    })
    upstream.on('error', reject)
    upstream.end()
  })
}

export default router
