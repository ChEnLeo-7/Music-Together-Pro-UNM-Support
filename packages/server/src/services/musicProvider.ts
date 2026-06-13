import Meting from '@meting/core'
import { get as kugouLrcGet, Format } from '@s4p/kugou-lrc'
import type { KrcInfo } from '@s4p/kugou-lrc'
import type { AudioQuality, MusicSource, Playlist, StreamSource, Track } from '@music-together/shared'
import { LRUCache } from 'lru-cache'
import { nanoid } from 'nanoid'
import { request as httpRequest } from 'node:http'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import pLimit from 'p-limit'
import ncmApi from '@neteasecloudmusicapienhanced/api'
import * as kugouAuth from './kugouAuthService.js'
import * as tencentAuth from './tencentAuthService.js'
import { config } from '../config.js'
import { getUnmServerTimeoutMs, getUnmServerUrl } from './runtimeConfigService.js'
import { logger } from '../utils/logger.js'

const require = createRequire(import.meta.url)
const generateNeteaseConfig = require('@neteasecloudmusicapienhanced/api/generateConfig') as () => Promise<void> | void
let neteaseConfigReady: Promise<boolean> | null = null

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isXeapiPublicKeyMissing(err: unknown): boolean {
  return getErrorMessage(err).includes('xeapi public key is missing')
}

function ensureNeteaseEnhancedConfig(force = false): Promise<boolean> {
  if (force) neteaseConfigReady = null
  if (!neteaseConfigReady) {
    neteaseConfigReady = Promise.resolve()
      .then(() => generateNeteaseConfig())
      .then(() => {
        logger.info('Netease enhanced API config initialized')
        return true
      })
      .catch((err: unknown) => {
        neteaseConfigReady = null
        logger.warn('Netease enhanced API config initialization failed', { err })
        return false
      })
  }
  return neteaseConfigReady
}

/** AMLL LyricLine 格式（与 @applemusic-like-lyrics/core 一致，避免引入 client 依赖） */
interface AmllLyricLine {
  words: Array<{ word: string; startTime: number; endTime: number; romanWord: string; obscene: boolean }>
  translatedLyric: string
  romanLyric: string
  startTime: number
  endTime: number
  isBG: boolean
  isDuet: boolean
}

/** 将 KRC 解析结果转为 AMLL LyricLine 格式 */
function krcToAmllLines(krcInfo: KrcInfo): AmllLyricLine[] {
  if (!krcInfo.items?.length) return []
  return krcInfo.items.map((line) => {
    if (!line.length) {
      return {
        words: [],
        translatedLyric: '',
        romanLyric: '',
        startTime: 0,
        endTime: 0,
        isBG: false,
        isDuet: false,
      }
    }
    const words = line.map((w) => ({
      word: w.word,
      startTime: Math.round(w.offset * 1000),
      endTime: Math.round((w.offset + w.duration) * 1000),
      romanWord: '',
      obscene: false,
    }))
    const first = words[0]!
    const last = words[words.length - 1]!
    return {
      words,
      translatedLyric: '',
      romanLyric: '',
      startTime: first.startTime,
      endTime: last.endTime,
      isBG: false,
      isDuet: false,
    }
  })
}

// ---------------------------------------------------------------------------
// Meting instance type (library has no TS declarations)
// ---------------------------------------------------------------------------
type MetingInstance = InstanceType<typeof Meting>

type MetingRuntimeInstance = MetingInstance & {
  _curl: (targetUrl: string, body?: unknown) => Promise<MetingRuntimeInstance>
  raw: string | null
  error: string | null
  status: string | null
  header: Record<string, string>
}

/** Parsed JSON from Meting API responses */
type MetingJson = Record<string, unknown>

/** Loosely typed ncmApi response (the library has no TS declarations). */
interface NcmApiResponse {
  body?: {
    code?: number
    songs?: Record<string, unknown>[]
    playlist?: Record<string, unknown>[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** Tencent 新版搜索 API 响应结构 */
interface TencentSearchResponse {
  code: number
  'music.search.SearchCgiService.DoSearchForQQMusicDesktop': {
    code: number
    data: {
      body: {
        song: {
          list: TencentSearchSong[]
        }
      }
      meta: {
        curpage: number
        perpage: number
        sum: number
        nextpage: number
      }
    }
  }
}

/** Tencent 搜索结果单曲结构 */
interface TencentSearchSong {
  id: number
  mid: string
  name: string
  title?: string
  interval: number
  singer: Array<{ id: number; mid: string; name: string }>
  album?: {
    id: number
    mid: string
    name: string
    pmid?: string
  }
  file?: {
    media_mid?: string
    size_128mp3?: number
    size_320mp3?: number
    size_flac?: number
  }
  pay?: {
    pay_down?: number
    pay_month?: number
    pay_play?: number
    price_track?: number
  }
  action?: {
    msgpay?: number
  }
}

/** External API timeout (ms) */
const API_TIMEOUT_MS = 15_000

/** Race a promise against a timeout. Returns null on timeout. */
async function withTimeout<T>(promise: Promise<T>, ms = API_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function normalizeAudioUrl(url: string | null): string | null {
  if (!url) return null
  if (url.startsWith('http://')) return url.replace(/^http:\/\//, 'https://')
  return url
}

function decodeNeteasePackageUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'music.163.com' || !parsed.pathname.startsWith('/package/')) return null

    const encoded = parsed.pathname.split('/').filter(Boolean)[1]
    if (!encoded) return null

    const base64 = decodeURIComponent(encoded).replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const decoded = Buffer.from(padded, 'base64').toString('utf8').trim()
    const target = new URL(decoded)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
    return normalizeAudioUrl(target.toString())
  } catch {
    return null
  }
}

function isTrialStream(data: MetingJson): boolean {
  const url = String(data.url ?? '')
  const freeTrialInfo = data.freeTrialInfo as Record<string, unknown> | null | undefined
  const freeTrialPrivilege = data.freeTrialPrivilege as Record<string, unknown> | null | undefined
  const freeTimeTrialPrivilege = data.freeTimeTrialPrivilege as Record<string, unknown> | null | undefined
  const time = Number(data.time ?? 0)

  return (
    url.includes('/trial/') ||
    url.includes('trial=true') ||
    Boolean(freeTrialInfo) ||
    freeTrialPrivilege?.resConsumable === true ||
    freeTrialPrivilege?.userConsumable === true ||
    freeTimeTrialPrivilege?.resConsumable === true ||
    freeTimeTrialPrivilege?.userConsumable === true ||
    (Number.isFinite(time) && time > 0 && time <= 35_000)
  )
}

function normalizeDirectIdInput(input: string): string {
  const trimmed = input.trim()
  const forced = trimmed.match(/^(?:id|song|track|music|playlist|album|歌单|专辑|歌曲)\s*[:：]\s*(.+)$/i)
  return (forced?.[1] ?? trimmed).trim()
}

function extractDirectId(input: string, source: MusicSource, type: 'song' | 'album' | 'playlist'): string | null {
  const normalized = normalizeDirectIdInput(input)
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    const idParam = url.searchParams.get('id') ?? url.searchParams.get('songmid') ?? url.searchParams.get('mid')
    const hashId = url.hash.match(/[?&](?:id|songmid|mid)=([^&]+)/)?.[1]
    const urlId = idParam ?? hashId

    if (source === 'netease') {
      const pathMatch = url.pathname.match(/\/(song|playlist|album)\/(\d+)/)
      const pathKind = pathMatch?.[1]
      if (pathMatch && pathKind === type) return pathMatch[2]!
      if (urlId && /^\d+$/.test(urlId)) return urlId
    }

    if (source === 'tencent') {
      const songMatch = url.pathname.match(/\/songDetail\/([A-Za-z0-9_-]+)/)
      const albumMatch = url.pathname.match(/\/albumDetail\/([A-Za-z0-9_-]+)/)
      const playlistMatch = url.pathname.match(/\/playlist\/(\d+)/)
      if (type === 'song' && songMatch) return songMatch[1]!
      if (type === 'album' && albumMatch) return albumMatch[1]!
      if (type === 'playlist' && playlistMatch) return playlistMatch[1]!
      if (urlId) return urlId
    }

    if (source === 'kugou') {
      const hash = url.searchParams.get('hash')
      const albumId = url.searchParams.get('albumid') ?? url.searchParams.get('album_id')
      const playlistId = url.searchParams.get('specialid') ?? url.searchParams.get('playlistid')
      if (type === 'song' && hash) return hash
      if (type === 'album' && albumId) return albumId
      if (type === 'playlist' && playlistId) return playlistId
      const pathMatch = url.pathname.match(/([A-Fa-f0-9]{32}|\d{4,})/)
      if (pathMatch) return pathMatch[1]!
    }
  } catch {
    // Plain ID, handled below.
  }

  if (source === 'netease') {
    return /^\d{3,}$/.test(normalized) ? normalized : null
  }

  if (source === 'tencent') {
    if (type === 'playlist') return /^\d{3,}$/.test(normalized) ? normalized : null
    if (/^[A-Za-z0-9_-]{10,}$/.test(normalized)) return normalized
    return /^\d{3,}$/.test(normalized) ? normalized : null
  }

  if (type === 'song') {
    return /^[A-Fa-f0-9]{32}$/.test(normalized) || /^[A-Za-z0-9_-]{20,}$/.test(normalized) ? normalized : null
  }
  return /^\d{3,}$/.test(normalized) ? normalized : null
}

function sourceLabel(source: MusicSource): string {
  if (source === 'netease') return '网易云'
  if (source === 'tencent') return 'QQ音乐'
  return '酷狗'
}

// Path to song list in raw (non-formatted) API response per platform
const SEARCH_PATHS: Record<MusicSource, string> = {
  netease: 'result.songs',
  tencent: 'data.song.list',
  kugou: 'data.info',
}

// Path to song list in raw playlist API response per platform
const PLAYLIST_PATHS: Record<MusicSource, string> = {
  netease: 'playlist.tracks', // Not used (Netease uses ncmApi)
  tencent: 'data.cdlist.0.songlist', // JS arrays support string numeric index
  kugou: 'data.info',
}

// ---------------------------------------------------------------------------
// Cache TTL constants
// ---------------------------------------------------------------------------
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

// ---------------------------------------------------------------------------
// TrackMeta — Track without per-instance fields (id, requestedBy)
// ---------------------------------------------------------------------------
type TrackMeta = Omit<Track, 'id' | 'requestedBy'>

export interface StreamUrlResult {
  url: string
  source: StreamSource
  quality?: AudioQuality
}

type NeteaseSoundQualityLevel =
  | 'standard'
  | 'higher'
  | 'exhigh'
  | 'lossless'
  | 'dolby'
  | 'hires'
  | 'jyeffect'
  | 'jymaster'
  | 'sky'

const NETEASE_QUALITY_ORDER: AudioQuality[] = [
  'netease_master',
  'netease_spatial',
  'netease_dolby',
  'netease_jyeffect',
  'netease_hires',
  999,
  320,
  192,
  128,
]

function neteaseQualityToLevel(quality: AudioQuality | number): NeteaseSoundQualityLevel | null {
  switch (quality) {
    case 128:
      return 'standard'
    case 192:
      return 'higher'
    case 320:
      return 'exhigh'
    case 999:
      return 'lossless'
    case 'netease_dolby':
      return 'dolby'
    case 'netease_hires':
      return 'hires'
    case 'netease_jyeffect':
      return 'jyeffect'
    case 'netease_spatial':
      return 'sky'
    case 'netease_master':
      return 'jymaster'
    default:
      return null
  }
}

const NETEASE_LEVEL_RANK: Record<NeteaseSoundQualityLevel, number> = {
  standard: 0,
  higher: 1,
  exhigh: 2,
  lossless: 3,
  hires: 4,
  jyeffect: 5,
  dolby: 6,
  sky: 7,
  jymaster: 8,
}

function neteaseLevelToQuality(level: unknown): AudioQuality | null {
  switch (String(level ?? '').toLowerCase()) {
    case 'standard':
      return 128
    case 'higher':
      return 192
    case 'exhigh':
      return 320
    case 'lossless':
      return 999
    case 'dolby':
      return 'netease_dolby'
    case 'hires':
      return 'netease_hires'
    case 'jyeffect':
      return 'netease_jyeffect'
    case 'sky':
      return 'netease_spatial'
    case 'jymaster':
      return 'netease_master'
    default:
      return null
  }
}

function isNeteaseReturnedLevelAcceptable(requestedQuality: AudioQuality | number, returnedLevel: unknown): boolean {
  const requestedLevel = neteaseQualityToLevel(requestedQuality)
  if (!requestedLevel) return true

  const returned = String(returnedLevel ?? '').toLowerCase() as NeteaseSoundQualityLevel
  if (!returned || NETEASE_LEVEL_RANK[returned] === undefined) return true

  if (typeof requestedQuality === 'string') return returned === requestedLevel

  return NETEASE_LEVEL_RANK[returned] >= NETEASE_LEVEL_RANK[requestedLevel]
}

function requiresExactNeteaseV1Level(quality: AudioQuality | number): boolean {
  const level = neteaseQualityToLevel(quality)
  return Boolean(level && NETEASE_LEVEL_RANK[level] > NETEASE_LEVEL_RANK.exhigh)
}

function cookieScopeKey(cookie?: string): string {
  if (!cookie) return 'public'
  return createHash('sha256').update(cookie).digest('hex').slice(0, 16)
}

function addUniqueQuality(list: AudioQuality[], quality: AudioQuality): void {
  if (!list.includes(quality)) list.push(quality)
}

function qualityToBitrate(quality: AudioQuality | number): number {
  if (typeof quality === 'number') return quality
  return 999
}

function createClientStreamUrl(_source: MusicSource, url: string, _roomId?: string): string {
  return decodeNeteasePackageUrl(url) ?? url
}

class MusicProvider {
  // Shared instances with format(true) — used for url/lyric/cover operations (no cookie)
  private instances = new Map<MusicSource, MetingInstance>()

  // ---------------------------------------------------------------------------
  // 3-Layer Cache Architecture
  // ---------------------------------------------------------------------------

  // Layer 1: Track Registry — single source of truth for all track metadata.
  // Every track that passes through the system (search, playlist) gets registered
  // here. Cross-context enrichment: search provides duration + cover, playlist
  // provides additional tracks. Merge strategy keeps the richest data.
  private trackRegistry = new LRUCache<string, TrackMeta>({
    max: 10_000,
    ttl: 2 * HOUR,
  })

  // Layer 2: Reference Indexes — store only sourceId arrays, NOT full Track objects.
  // Memory-efficient: a 2000-track playlist costs ~40KB (IDs) instead of ~1MB (Track[]).
  private searchIndex = new LRUCache<string, { source: MusicSource; ids: string[] }>({
    max: 200,
    ttl: 10 * MINUTE,
  })
  private playlistIndex = new LRUCache<string, { source: MusicSource; ids: string[] }>({
    max: 50,
    ttl: 30 * MINUTE,
  })

  // Layer 3: Resource Caches — scalar values for stream URLs, covers, lyrics.
  private streamUrlCache = new LRUCache<string, string>({ max: 500, ttl: 1 * HOUR })
  private neteaseQualityCache = new LRUCache<string, AudioQuality[]>({ max: 1000, ttl: 1 * HOUR })
  private coverCache = new LRUCache<string, string>({ max: 1000, ttl: 24 * HOUR })
  private lyricCache = new LRUCache<
    string,
    { lyric: string; tlyric: string; romalrc: string; yrc: string; wordByWord?: AmllLyricLine[] }
  >({
    max: 500,
    ttl: 24 * HOUR,
  })

  private getInstance(source: MusicSource): MetingInstance {
    let m = this.instances.get(source)
    if (!m) {
      m = new Meting(source)
      m.format(true)
      this.instances.set(source, m)
    }
    return m
  }

  // ---------------------------------------------------------------------------
  // Track Registry helpers
  // ---------------------------------------------------------------------------

  /**
   * Register tracks into the registry, merging with existing data.
   * Merge strategy: keep the richer value for each field (non-empty wins).
   * This enables cross-context enrichment: search provides duration + cover,
   * playlist provides additional tracks, and both benefit from each other.
   */
  private registerTracks(tracks: Track[]): void {
    for (const t of tracks) {
      const key = `${t.source}:${t.sourceId}`
      const existing = this.trackRegistry.get(key)
      const { id: _id, requestedBy: _rb, ...meta } = t
      if (existing) {
        const merged: TrackMeta = {
          ...existing,
          cover: existing.cover || meta.cover,
          duration: existing.duration || meta.duration,
          vip: existing.vip || meta.vip,
        }
        this.trackRegistry.set(key, merged)
      } else {
        this.trackRegistry.set(key, meta)
      }
    }
  }

  /**
   * Enrich a track in-place from the registry (fill missing cover, duration, vip).
   * Called before caching playlist tracks so that previously-searched tracks
   * get their duration and cover carried over.
   */
  private enrichFromRegistry(track: Track): void {
    const cached = this.trackRegistry.get(`${track.source}:${track.sourceId}`)
    if (!cached) return
    if (!track.cover && cached.cover) track.cover = cached.cover
    if (!track.duration && cached.duration) track.duration = cached.duration
    if (!track.vip && cached.vip) track.vip = cached.vip
  }

  /**
   * Hydrate sourceId[] back into Track[] from the registry.
   * Returns null if ANY id is missing (registry eviction) — caller should
   * treat this as a cache miss and re-fetch from Meting.
   * Each hydrated Track gets a fresh nanoid for its `id` field.
   */
  private hydrateFromRegistry(source: MusicSource, ids: string[]): Track[] | null {
    const tracks: Track[] = []
    for (const sourceId of ids) {
      const meta = this.trackRegistry.get(`${source}:${sourceId}`)
      if (!meta) return null
      tracks.push({ ...meta, id: nanoid() })
    }
    return tracks
  }

  // ---------------------------------------------------------------------------
  // Public API — Search
  // ---------------------------------------------------------------------------

  /**
   * Search Tencent (QQ 音乐) using the new Desktop API.
   * The legacy Meting API returns empty results, so we use the direct API.
   */
  private async searchTencent(keyword: string, limit = 20, page = 1): Promise<Track[]> {
    // Early Exit: empty keyword
    if (!keyword.trim()) return []

    try {
      const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
      const payload = {
        comm: {
          ct: '6',
          cv: '80600',
          tmeAppID: 'qqmusic',
        },
        'music.search.SearchCgiService.DoSearchForQQMusicDesktop': {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicDesktop',
          param: {
            num_per_page: limit,
            page_num: page,
            search_type: 0,
            query: keyword,
            grp: 1,
          },
        },
      }

      const response = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Referer: 'https://y.qq.com',
            'User-Agent': 'QQ%E9%9F%B3%E4%B9%90/73222',
          },
          body: JSON.stringify(payload),
        }).then((res) => res.json() as Promise<TencentSearchResponse>),
      )

      // Fail Fast: timeout or null response
      if (!response) {
        logger.warn(`Tencent search timeout for "${keyword}"`)
        return []
      }

      const result = response['music.search.SearchCgiService.DoSearchForQQMusicDesktop']
      // Fail Fast: invalid response code or missing data
      if (result?.code !== 0 || !result?.data?.body?.song?.list) {
        logger.warn(`Tencent search failed: code ${result?.code}`)
        return []
      }

      const songList = result.data.body.song.list

      // Transform to Track format (Atomic Predictability: pure transformation)
      const tracks: Track[] = songList.map((song) => ({
        id: nanoid(),
        source: 'tencent' as const,
        sourceId: song.mid,
        title: song.name || song.title || 'Unknown',
        artist: song.singer?.map((s) => s.name).filter(Boolean) || ['Unknown'],
        album: song.album?.name || '',
        duration: song.interval || 0, // already in seconds
        cover: song.album?.pmid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.pmid}.jpg` : '',
        urlId: song.mid,
        lyricId: song.mid,
        picId: song.album?.mid || '',
        // VIP 判断: pay_month=1 月度会员, pay_down=1 付费下载, msgpay>0 VIP 标志
        vip: song.pay?.pay_month === 1 || song.pay?.pay_down === 1 || (song.action?.msgpay ?? 0) > 0,
      }))

      // Register into track registry and search index
      this.registerTracks(tracks)

      logger.info(`Search "${keyword}" on tencent: ${tracks.length} results`)
      return tracks
    } catch (error) {
      logger.error('Tencent search failed:', error)
      return []
    }
  }

  /**
   * Search for tracks. Uses format(false) to get raw API data including duration,
   * then batch-resolves cover URLs.
   */

  async getSongById(source: MusicSource, input: string): Promise<Track | null> {
    const id = extractDirectId(input, source, 'song')
    if (!id) return null

    try {
      let tracks: Track[] = []

      if (source === 'netease') {
        const res = await withTimeout(ncmApi.song_detail({ ids: id, timestamp: Date.now() }))
        const song = res?.body?.songs?.[0]
        if (!song) return null
        tracks = [this.rawToTrack(song, 'netease')]
      } else {
        const meting = new Meting(source)
        meting.format(false)
        const raw = await withTimeout(meting.song(id))
        if (!raw) return null

        let data: unknown
        try {
          data = JSON.parse(raw as string)
        } catch {
          return null
        }
        const items = Array.isArray(data) ? data : [data]
        tracks = items
          .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
          .map((item) => this.rawToTrack(item, source))
      }

      const track = tracks[0]
      if (!track) return null
      await this.batchResolveCover([track], source)
      this.registerTracks([track])
      logger.info(`Direct song ID resolved: ${source}/${id}`)
      return track
    } catch (err) {
      logger.warn(`Direct song ID resolve failed: ${source}/${id}`, { err })
      return null
    }
  }

  async getCollectionById(source: MusicSource, input: string, type: 'album' | 'playlist'): Promise<Playlist | null> {
    const id = extractDirectId(input, source, type)
    if (!id) return null

    try {
      const page = await this.getPlaylistPage(source, id, 1, 0, undefined, null, type)
      if (page.total === 0) return null
      const firstTrack = page.tracks[0]
      const fallbackName = `${sourceLabel(source)} ${type === 'album' ? '专辑' : '歌单'} ${id}`
      const playlist: Playlist = {
        id,
        name: type === 'album' ? firstTrack?.album || fallbackName : fallbackName,
        cover: firstTrack?.cover || '',
        trackCount: page.total,
        source,
        creator: type === 'album' ? firstTrack?.artist.join(' / ') : undefined,
      }
      logger.info(`Direct ${type} ID resolved: ${source}/${id} (${page.total} tracks)`)
      return playlist
    } catch (err) {
      logger.warn(`Direct ${type} ID resolve failed: ${source}/${id}`, { err })
      return null
    }
  }
  
  /**
   * Search for albums. Returns a list of Playlist objects.
   */
  async searchAlbum(source: MusicSource, keyword: string, limit = 20, page = 1): Promise<import('@music-together/shared').Playlist[]> {
    if (!keyword.trim()) return []

    try {
      if (source === 'tencent') {
        const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
        const payload = {
          comm: { ct: '6', cv: '80600', tmeAppID: 'qqmusic' },
          'music.search.SearchCgiService.DoSearchForQQMusicDesktop': {
            module: 'music.search.SearchCgiService',
            method: 'DoSearchForQQMusicDesktop',
            param: { num_per_page: limit, page_num: page, search_type: 2, query: keyword, grp: 1 },
          },
        }

        const response = await withTimeout(
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Referer: 'https://y.qq.com',
              'User-Agent': 'QQ%E9%9F%B3%E4%B9%90/73222',
            },
            body: JSON.stringify(payload),
          }).then((res) => res.json())
        )

        if (!response) return []

        const result = response['music.search.SearchCgiService.DoSearchForQQMusicDesktop']
        if (result?.code !== 0 || !result?.data?.body?.album?.list) return []

        return result.data.body.album.list.map((album: any) => ({
          id: String(album.albumMID || album.albumID),
          name: album.albumName || 'Unknown Album',
          cover: album.albumPic || '',
          trackCount: album.song_count || 0,
          source: 'tencent',
          creator: album.singerName || '',
        }))
      }

      if (source === 'kugou') {
        const url = `http://mobilecdn.kugou.com/api/v3/search/album?api_ver=1&area_code=1&correct=1&pagesize=${limit}&plat=2&tag=1&sver=5&showtype=10&page=${page}&keyword=${encodeURIComponent(keyword)}&version=8990`
        const response = await withTimeout(fetch(url).then(res => res.json()))
        
        if (!response || response.errcode !== 0 || !response.data?.info) return []
        
        return response.data.info.map((album: any) => ({
          id: String(album.albumid),
          name: album.albumname || 'Unknown Album',
          cover: (album.imgurl || '').replace('{size}', '400'),
          trackCount: album.songcount || 0,
          source: 'kugou',
          creator: album.singername || '',
        }))
      }

      if (source === 'netease') {
        const meting = new Meting('netease')
        meting.format(false) // Important: don't format because format expects songs
        const raw = await withTimeout(meting.search(keyword, { limit, page, type: 10 } as any))
        if (!raw) return []

        let data: any
        try {
          data = JSON.parse(raw as string)
        } catch {
          return []
        }

        const albums = data?.result?.albums
        if (!Array.isArray(albums)) return []

        return albums.map((album: any) => ({
          id: String(album.id),
          name: album.name || 'Unknown Album',
          cover: album.picUrl || album.blurPicUrl || '',
          trackCount: album.size || 0,
          source: 'netease',
          creator: album.artist?.name || '',
        }))
      }

      return []
    } catch (err) {
      logger.error(`Search album failed for ${source}:`, err)
      return []
    }
  }

  /**
   * Search for playlists. Returns a list of Playlist objects.
   */
  async searchPlaylist(source: MusicSource, keyword: string, limit = 20, page = 1): Promise<import('@music-together/shared').Playlist[]> {
    if (!keyword.trim()) return []

    try {
      if (source === 'tencent') {
        const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
        const payload = {
          comm: { ct: '6', cv: '80600', tmeAppID: 'qqmusic' },
          'music.search.SearchCgiService.DoSearchForQQMusicDesktop': {
            module: 'music.search.SearchCgiService',
            method: 'DoSearchForQQMusicDesktop',
            param: { num_per_page: limit, page_num: page, search_type: 3, query: keyword, grp: 1 },
          },
        }

        const response = await withTimeout(
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Referer: 'https://y.qq.com',
              'User-Agent': 'QQ%E9%9F%B3%E4%B9%90/73222',
            },
            body: JSON.stringify(payload),
          }).then((res) => res.json())
        )

        if (!response) return []

        const result = response['music.search.SearchCgiService.DoSearchForQQMusicDesktop']
        if (result?.code !== 0 || !result?.data?.body?.songlist?.list) return []

        return result.data.body.songlist.list.map((playlist: any) => ({
          id: String(playlist.dissid),
          name: playlist.dissname || 'Unknown Playlist',
          cover: playlist.imgurl || '',
          trackCount: playlist.song_count || 0,
          source: 'tencent',
          creator: playlist.creator?.name || '',
          description: playlist.introduction || '',
        }))
      }

      if (source === 'kugou') {
        const url = `http://mobilecdn.kugou.com/api/v3/search/special?api_ver=1&area_code=1&correct=1&pagesize=${limit}&plat=2&tag=1&sver=5&showtype=10&page=${page}&keyword=${encodeURIComponent(keyword)}&version=8990`
        const response = await withTimeout(fetch(url).then(res => res.json()))
        
        if (!response || response.errcode !== 0 || !response.data?.info) return []
        
        return response.data.info.map((playlist: any) => ({
          id: String(playlist.specialid),
          name: playlist.specialname || 'Unknown Playlist',
          cover: (playlist.imgurl || '').replace('{size}', '400'),
          trackCount: playlist.songcount || 0,
          source: 'kugou',
          creator: playlist.nickname || '',
          description: playlist.intro || '',
        }))
      }

      if (source === 'netease') {
        const meting = new Meting('netease')
        meting.format(false) // Important: don't format because format expects songs
        const raw = await withTimeout(meting.search(keyword, { limit, page, type: 1000 } as any))
        if (!raw) return []

        let data: any
        try {
          data = JSON.parse(raw as string)
        } catch {
          return []
        }

        const playlists = data?.result?.playlists
        if (!Array.isArray(playlists)) return []

        return playlists.map((playlist: any) => ({
          id: String(playlist.id),
          name: playlist.name || 'Unknown Playlist',
          cover: playlist.coverImgUrl || playlist.picUrl || '',
          trackCount: playlist.trackCount || 0,
          source: 'netease',
          creator: playlist.creator?.nickname || '',
          description: playlist.description || '',
        }))
      }

      return []
    } catch (err) {
      logger.error(`Search playlist failed for ${source}:`, err)
      return []
    }
  }

  async search(source: MusicSource, keyword: string, limit = 20, page = 1): Promise<Track[]> {
    const cacheKey = `${source}:${keyword}:${limit}:${page}`

    // Check reference index
    const indexed = this.searchIndex.get(cacheKey)
    if (indexed) {
      const hydrated = this.hydrateFromRegistry(indexed.source, indexed.ids)
      if (hydrated) {
        logger.info(`Search cache hit: "${keyword}" on ${source} (page ${page})`)
        return hydrated
      }
      // Registry eviction — stale index, fall through to re-fetch
      this.searchIndex.delete(cacheKey)
      logger.info(`Search index stale (registry eviction): "${keyword}" on ${source}`)
    }

    try {
      // QQ 音乐使用新版搜索 API (Meting API 已失效)
      if (source === 'tencent') {
        const tracks = await this.searchTencent(keyword, limit, page)
        // Update search index (cacheKey already defined above)
        this.searchIndex.set(cacheKey, {
          source,
          ids: tracks.map((t) => t.sourceId),
        })
        return tracks
      }

      // Fresh instance without format — gets raw API response with all fields
      const meting = new Meting(source)
      const raw = await withTimeout(meting.search(keyword, { limit, page }))
      if (raw === null) {
        logger.warn(`Search timeout for ${source}: "${keyword}"`)
        return []
      }

      let rawData: MetingJson
      try {
        rawData = JSON.parse(raw) as MetingJson
      } catch (parseError) {
        logger.error(`Search JSON parse failed for ${source}`)
        logger.error(`Parse error:`, parseError)
        logger.error(`Full raw response:`, raw)
        logger.error(`Raw response type:`, typeof raw)
        logger.error(`Raw response length:`, raw?.length)
        return []
      }

      const songs = this.navigatePath(rawData, SEARCH_PATHS[source])
      if (!Array.isArray(songs) || songs.length === 0) return []

      const tracks = songs.map((song: MetingJson) => this.rawToTrack(song, source))

      // Batch resolve cover URLs for tracks that don't already have one
      await this.batchResolveCover(tracks, source)

      // Register into Layer 1 and index into Layer 2
      this.registerTracks(tracks)
      this.searchIndex.set(cacheKey, {
        source,
        ids: tracks.map((t) => t.sourceId),
      })

      logger.info(`Search "${keyword}" on ${source}: ${tracks.length} results`)
      return tracks
    } catch (err) {
      logger.error(`Search failed for ${source}:`, err)
      return []
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — Stream URL, Lyric, Cover (unchanged from original)
  // ---------------------------------------------------------------------------

  private collectLevelStrings(value: unknown, result = new Set<string>()): Set<string> {
    if (value === null || value === undefined) return result
    if (typeof value === 'string') {
      result.add(value.toLowerCase())
      return result
    }
    if (typeof value !== 'object') return result
    if (Array.isArray(value)) {
      for (const item of value) this.collectLevelStrings(item, result)
      return result
    }

    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase()
      if (normalizedKey.includes('level') || normalizedKey.includes('quality')) {
        this.collectLevelStrings(nested, result)
      } else if (typeof nested === 'object' && nested !== null) {
        this.collectLevelStrings(nested, result)
      }
    }
    return result
  }

  private parseNeteaseAvailableQualities(
    song: Record<string, unknown>,
    privilege?: Record<string, unknown>,
    musicDetail?: Record<string, unknown>,
  ): AudioQuality[] {
    const qualities: AudioQuality[] = []
    addUniqueQuality(qualities, 128)

    const detail = musicDetail ?? {}
    if (song.m || song.h || song.sq || song.hr || detail.m || detail.h || detail.sq || detail.hr) addUniqueQuality(qualities, 192)
    if (song.h || song.sq || song.hr || detail.h || detail.sq || detail.hr) addUniqueQuality(qualities, 320)
    if (song.sq || song.hr || detail.sq || detail.hr) addUniqueQuality(qualities, 999)
    if (song.db || detail.db) addUniqueQuality(qualities, 'netease_dolby')
    if (song.hr || detail.hr) addUniqueQuality(qualities, 'netease_hires')
    if (detail.je) addUniqueQuality(qualities, 'netease_jyeffect')
    if (detail.sk || (Array.isArray(detail.sks) && detail.sks.length > 0)) addUniqueQuality(qualities, 'netease_spatial')
    if (detail.jm) addUniqueQuality(qualities, 'netease_master')

    const levels = this.collectLevelStrings({ song, privilege, musicDetail })
    if (levels.has('exhigh') || levels.has('higher') || levels.has('standard')) {
      addUniqueQuality(qualities, 320)
    }
    if (levels.has('lossless') || levels.has('jyeffect') || levels.has('sky') || levels.has('jymaster')) {
      addUniqueQuality(qualities, 999)
    }
    if (levels.has('hires')) addUniqueQuality(qualities, 'netease_hires')
    if (levels.has('dolby')) addUniqueQuality(qualities, 'netease_dolby')
    if (levels.has('jyeffect')) addUniqueQuality(qualities, 'netease_jyeffect')
    if (levels.has('sky')) addUniqueQuality(qualities, 'netease_spatial')
    if (levels.has('jymaster')) addUniqueQuality(qualities, 'netease_master')

    return NETEASE_QUALITY_ORDER.filter((quality) => qualities.includes(quality))
  }

  async getNeteaseAvailableQualities(urlId: string, cookie?: string): Promise<AudioQuality[]> {
    const cacheKey = `${urlId}:${cookieScopeKey(cookie)}`
    const cached = this.neteaseQualityCache.get(cacheKey)
    if (cached) return cached

    try {
      const params = { timestamp: Date.now(), ...(cookie ? { cookie } : {}) }
      const [detailRes, musicDetailRes] = await Promise.all([
        withTimeout(ncmApi.song_detail({ ids: urlId, ...params })),
        withTimeout(ncmApi.song_music_detail({ id: urlId, ...params })).catch((err) => {
          logger.warn(`Netease song music detail fetch failed: ${urlId}`, { err })
          return null
        }),
      ])
      const song = detailRes?.body?.songs?.[0] as Record<string, unknown> | undefined
      const privilege = detailRes?.body?.privileges?.[0] as Record<string, unknown> | undefined
      const musicDetail = musicDetailRes?.body?.data as Record<string, unknown> | undefined
      if (!song) {
        const fallback: AudioQuality[] = [128, 192, 320]
        this.neteaseQualityCache.set(cacheKey, fallback)
        return fallback
      }

      const qualities = this.parseNeteaseAvailableQualities(song, privilege, musicDetail)
      const result: AudioQuality[] = qualities.length ? qualities : [128, 192, 320]
      this.neteaseQualityCache.set(cacheKey, result)
      logger.info('Netease available qualities parsed', {
        urlId,
        availableQualities: result.map(String),
      })
      return result
    } catch (err) {
      logger.warn(`Netease song detail quality fetch failed: ${urlId}`, { err })
      return [128, 192, 320]
    }
  }

  private async getNeteaseStreamUrlV1(urlId: string, quality: AudioQuality | number, cookie?: string, roomId?: string): Promise<StreamUrlResult | null> {
    const level = neteaseQualityToLevel(quality)
    if (!level) return null

    try {
      await ensureNeteaseEnhancedConfig()
      const res = await withTimeout(ncmApi.song_url_v1({ id: urlId, level, timestamp: Date.now(), ...(cookie ? { cookie } : {}) }))
      const data = res?.body?.data?.[0] as MetingJson | undefined
      if (!data) return null
      const returnedLevel = data.level
      const returnedQuality = neteaseLevelToQuality(returnedLevel)
      logger.info('Netease song_url_v1 response', {
        urlId,
        requestedLevel: level,
        returnedLevel: typeof returnedLevel === 'string' ? returnedLevel : undefined,
        br: Number(data.br ?? 0) || undefined,
        size: Number(data.size ?? 0) || undefined,
      })
      if (!isNeteaseReturnedLevelAcceptable(quality, returnedLevel)) {
        logger.warn('Netease song_url_v1 returned downgraded quality, rejecting stream', {
          urlId,
          requestedLevel: level,
          returnedLevel: typeof returnedLevel === 'string' ? returnedLevel : undefined,
          br: Number(data.br ?? 0) || undefined,
          size: Number(data.size ?? 0) || undefined,
        })
        return null
      }
      let url = normalizeAudioUrl((data.url as string) || null)
      if (url && isTrialStream(data)) {
        logger.warn(`Netease v1 trial stream rejected: ${urlId}/${level}`)
        return null
      }
      if (url?.startsWith('http://')) url = url.replace(/^http:\/\//, 'https://')
      return url ? { url: createClientStreamUrl('netease', url, roomId), source: 'netease', quality: returnedQuality ?? (quality as AudioQuality) } : null
    } catch (err) {
      if (isXeapiPublicKeyMissing(err)) {
        const initialized = await ensureNeteaseEnhancedConfig(true)
        if (initialized) {
          try {
            const res = await withTimeout(ncmApi.song_url_v1({ id: urlId, level, timestamp: Date.now(), ...(cookie ? { cookie } : {}) }))
            const data = res?.body?.data?.[0] as MetingJson | undefined
            if (!data) return null
            const returnedLevel = data.level
            const returnedQuality = neteaseLevelToQuality(returnedLevel)
            logger.info('Netease song_url_v1 response', {
              urlId,
              requestedLevel: level,
              returnedLevel: typeof returnedLevel === 'string' ? returnedLevel : undefined,
              br: Number(data.br ?? 0) || undefined,
              size: Number(data.size ?? 0) || undefined,
              retriedAfterConfigInit: true,
            })
            if (!isNeteaseReturnedLevelAcceptable(quality, returnedLevel)) {
              logger.warn('Netease song_url_v1 returned downgraded quality, rejecting stream', {
                urlId,
                requestedLevel: level,
                returnedLevel: typeof returnedLevel === 'string' ? returnedLevel : undefined,
                br: Number(data.br ?? 0) || undefined,
                size: Number(data.size ?? 0) || undefined,
                retriedAfterConfigInit: true,
              })
              return null
            }
            let url = normalizeAudioUrl((data.url as string) || null)
            if (url && isTrialStream(data)) {
              logger.warn(`Netease v1 trial stream rejected: ${urlId}/${level}`)
              return null
            }
            if (url?.startsWith('http://')) url = url.replace(/^http:\/\//, 'https://')
            return url ? { url: createClientStreamUrl('netease', url, roomId), source: 'netease', quality: returnedQuality ?? (quality as AudioQuality) } : null
          } catch (retryErr) {
            logger.warn(`Netease song_url_v1 retry failed: ${urlId}/${level}`, { err: retryErr })
            return null
          }
        }
      }
      logger.warn(`Netease song_url_v1 failed: ${urlId}/${level}`, { err })
      return null
    }
  }

  /**
   * Get stream URL for a track. Optionally inject a cookie for VIP access.
   * When cookie is provided, a fresh Meting instance is created to avoid
   * polluting the shared cached instance — and the result is NOT cached
   * because VIP URLs are user-specific.
   */
  async getStreamUrl(
    source: MusicSource,
    urlId: string,
    quality: AudioQuality | number = 320,
    cookie?: string,
    roomId?: string,
    options: { unmMode?: 'fallback' | 'disabled' | 'only' } = {},
  ): Promise<StreamUrlResult | null> {
    const bitrate = qualityToBitrate(quality)
    const qualityCacheKey = String(quality)
    const hasUnm = source === 'netease' && options.unmMode !== 'disabled' && Boolean(getUnmServerUrl(roomId))

    if (options.unmMode === 'only') {
      return hasUnm ? this.getNeteaseStreamUrlViaUnmProxy(urlId, bitrate, cookie, roomId) : null
    }

    // Skip cache when cookie is provided (VIP URLs are user-specific)
    if (!cookie) {
      const cacheKey = `${source}:${urlId}:${qualityCacheKey}:${roomId ?? ''}`
      const cached = this.streamUrlCache.get(cacheKey)
      if (cached) {
        logger.info('Stream URL cache hit', {
          roomId,
          source,
          urlId,
          route: 'platform',
          requestedQuality: String(quality),
          streamQuality: String(quality),
        })
        return { url: cached, source, quality: quality as AudioQuality }
      }
    }

    try {
      if (source === 'netease') {
        const v1 = await this.getNeteaseStreamUrlV1(urlId, quality, cookie, roomId)
        if (v1) {
          if (!cookie) this.streamUrlCache.set(`${source}:${urlId}:${qualityCacheKey}:${roomId ?? ''}`, v1.url)
          logger.info('Platform stream URL resolved', {
            roomId,
            source,
            urlId,
            route: 'platform',
            requestedQuality: String(quality),
            streamQuality: String(v1.quality ?? quality),
          })
          return v1
        }
        if (requiresExactNeteaseV1Level(quality)) {
          return hasUnm ? this.getNeteaseStreamUrlViaUnmProxy(urlId, bitrate, cookie, roomId) : null
        }
      }

      let meting: MetingInstance
      if (cookie) {
        // Fresh instance with cookie — don't pollute the shared one
        meting = new Meting(source)
        meting.format(true)
        meting.cookie(cookie)
      } else {
        meting = this.getInstance(source)
      }
      const raw = await withTimeout(meting.url(urlId, bitrate))
      if (raw === null || raw === undefined) {
        logger.warn(`URL fetch timeout for ${source}: ${urlId}`)
        return hasUnm ? this.getNeteaseStreamUrlViaUnmProxy(urlId, bitrate, cookie, roomId) : null
      }
      let data: MetingJson
      try {
        data = JSON.parse(raw as string) as MetingJson
      } catch {
        return hasUnm ? this.getNeteaseStreamUrlViaUnmProxy(urlId, bitrate, cookie, roomId) : null
      }
      let url = normalizeAudioUrl((data.url as string) || null)
      if (url && isTrialStream(data)) {
        logger.warn(`Trial stream rejected for ${source}:${urlId}`)
        if (hasUnm) {
          const unm = await this.getNeteaseStreamUrlViaUnmProxy(urlId, bitrate, cookie, roomId)
          if (unm) return unm
        }
        return null
      }
      // 强制 HTTPS，避免 HTTPS 页面加载 HTTP 音频触发 Mixed Content 警告
      if (url?.startsWith('http://')) {
        url = url.replace(/^http:\/\//, 'https://')
      }

      if (!url && source === 'netease') {
        const unm = await this.getNeteaseStreamUrlViaUnmProxy(urlId, bitrate, cookie, roomId)
        if (unm) return unm
      }

      // Only cache non-cookie & successful results (null = transient failure, retry next time)
      if (!cookie && url) {
        this.streamUrlCache.set(`${source}:${urlId}:${qualityCacheKey}:${roomId ?? ''}`, createClientStreamUrl(source, url, roomId))
      }

      if (url) {
        logger.info('Platform stream URL resolved', {
          roomId,
          source,
          urlId,
          route: 'platform',
          requestedQuality: String(quality),
          streamQuality: String(quality),
        })
        return { url: createClientStreamUrl(source, url, roomId), source, quality: quality as AudioQuality }
      }
      return null
    } catch (err) {
      logger.error(`Get URL failed for ${source}:`, err)
      if (hasUnm) {
        return this.getNeteaseStreamUrlViaUnmProxy(urlId, bitrate, cookie, roomId)
      }
      return null
    }
  }

  private async getNeteaseStreamUrlViaUnmProxy(urlId: string, bitrate: number, cookie?: string, roomId?: string): Promise<StreamUrlResult | null> {
    if (!getUnmServerUrl(roomId)) return null

    try {
      const meting = new Meting('netease')
      meting.format(true)
      if (cookie) meting.cookie(cookie)
      this.applyUnmProxyToMeting(meting, roomId)

      const raw = await withTimeout(meting.url(urlId, bitrate), getUnmServerTimeoutMs())
      if (raw === null || raw === undefined) {
        logger.warn(`UNM proxy URL fetch timeout for netease:${urlId}`)
        return null
      }

      const data = JSON.parse(raw as string) as MetingJson
      const url = normalizeAudioUrl((data.url as string) || null)
      if (url) {
        const clientUrl = createClientStreamUrl('netease', url, roomId)
        logger.info(`UNM proxy stream URL resolved for netease:${urlId}`, {
          roomId,
          route: 'unm',
          requestedBitrate: bitrate,
          streamQuality: bitrate >= 999 ? '999' : String(bitrate),
          host: new URL(clientUrl).host,
          path: new URL(clientUrl).pathname.slice(0, 80),
          directClientUrl: true,
        })
        return { url: clientUrl, source: 'unm', quality: (bitrate >= 999 ? 999 : bitrate) as AudioQuality }
      }
      return null
    } catch (err) {
      logger.error(`UNM proxy URL fetch failed for netease:${urlId}`, err)
      return null
    }
  }

  private applyUnmProxyToMeting(meting: MetingInstance, roomId?: string): void {
    const runtimeMeting = meting as MetingRuntimeInstance
    const proxyUrl = new URL(getUnmServerUrl(roomId))
    runtimeMeting._curl = async (targetUrl: string, body: unknown = null) => {
      const requestBody =
        body && typeof body === 'object' && !Buffer.isBuffer(body) && typeof body !== 'string'
          ? new URLSearchParams(body as Record<string, string>).toString()
          : body

      const target = new URL(targetUrl)
      const responseText = await this.requestViaHttpProxy(proxyUrl, target, requestBody, runtimeMeting.header)
      runtimeMeting.raw = responseText
      runtimeMeting.error = null
      runtimeMeting.status = ''
      return runtimeMeting
    }
  }

  private requestViaHttpProxy(
    proxyUrl: URL,
    targetUrl: URL,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : null
      const req = httpRequest(
        {
          host: proxyUrl.hostname,
          port: proxyUrl.port ? Number(proxyUrl.port) : 80,
          method: payload ? 'POST' : 'GET',
          path: targetUrl.toString(),
          headers: {
            ...headers,
            Host: targetUrl.host,
            Connection: 'close',
            'Content-Type': headers['Content-Type'] ?? 'application/x-www-form-urlencoded',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
          timeout: getUnmServerTimeoutMs(),
        },
        (res) => {
          let data = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`UNM proxy HTTP ${res.statusCode}`))
              return
            }
            resolve(data)
          })
        },
      )

      req.on('timeout', () => {
        req.destroy(new Error('UNM proxy request timeout'))
      })
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })
  }

  async getLyric(
    source: MusicSource,
    lyricId: string,
  ): Promise<{ lyric: string; tlyric: string; romalrc: string; yrc: string; wordByWord?: AmllLyricLine[] }> {
    const cacheKey = `${source}:${lyricId}`
    const cached = this.lyricCache.get(cacheKey)
    if (cached) {
      logger.info(`Lyric cache hit: ${source}/${lyricId}`)
      return cached
    }

    const empty = { lyric: '', tlyric: '', romalrc: '', yrc: '' as string }

    try {
      let result: { lyric: string; tlyric: string; romalrc: string; yrc: string; wordByWord?: AmllLyricLine[] } = {
        ...empty,
      }

      if (source === 'netease') {
        // 使用 ncmApi.lyric_new 获取包含逐词歌词 (YRC) 的完整响应
        const res = await withTimeout(ncmApi.lyric_new({ id: lyricId }))
        if (!res?.body) {
          logger.warn(`Lyric fetch timeout for ${source}: ${lyricId}`)
          return empty
        }
        const body = res.body
        result = {
          lyric: (body.lrc?.lyric as string) || '',
          tlyric: (body.tlyric?.lyric as string) || '',
          romalrc: ((body.romalrc as Record<string, unknown> | undefined)?.lyric as string) || '',
          yrc: (body.yrc?.lyric as string) || '',
        }
        if (result.yrc) {
          logger.info(`YRC lyric found for netease:${lyricId}`)
        }
      } else if (source === 'kugou') {
        // 酷狗：Meting 获取 LRC + kugou-lrc 获取 KRC 逐字歌词
        const meting = this.getInstance(source)
        const raw = await withTimeout(meting.lyric(lyricId))
        if (raw === null || raw === undefined) {
          logger.warn(`Lyric fetch timeout for ${source}: ${lyricId}`)
          return empty
        }
        try {
          const data = JSON.parse(raw as string) as MetingJson
          result = {
            lyric: (data.lyric as string) || '',
            tlyric: (data.tlyric as string) || '',
            romalrc: '',
            yrc: '',
          }
        } catch {
          return empty
        }
        // 尝试获取 KRC 逐字歌词
        try {
          const krcInfo = await withTimeout(kugouLrcGet({ hash: lyricId, fmt: Format.krc }))
          if (krcInfo?.items?.length) {
            result.wordByWord = krcToAmllLines(krcInfo)
            logger.info(`KRC lyric found for kugou:${lyricId}`)
          }
        } catch {
          /* 静默回退到 LRC */
        }
      } else {
        // QQ 音乐：使用 Meting 默认流程
        const meting = this.getInstance(source)
        const raw = await withTimeout(meting.lyric(lyricId))
        if (raw === null || raw === undefined) {
          logger.warn(`Lyric fetch timeout for ${source}: ${lyricId}`)
          return empty
        }
        try {
          const data = JSON.parse(raw as string) as MetingJson
          result = {
            lyric: (data.lyric as string) || '',
            tlyric: (data.tlyric as string) || '',
            romalrc: '',
            yrc: '',
          }
        } catch {
          return empty
        }
      }

      this.lyricCache.set(cacheKey, result)
      return result
    } catch (err) {
      logger.error(`Get lyric failed for ${source}:`, err)
      return empty
    }
  }

  async getCover(source: MusicSource, picId: string, size = 300): Promise<string> {
    const cacheKey = `${source}:${picId}:${size}`
    const cached = this.coverCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    try {
      const meting = this.getInstance(source)
      const raw = await withTimeout(meting.pic(picId, size))
      if (raw === null || raw === undefined) {
        logger.warn(`Cover fetch timeout for ${source}: ${picId}`)
        return ''
      }
      let data: MetingJson
      try {
        data = JSON.parse(raw as string) as MetingJson
      } catch {
        return ''
      }
      const url = (data.url as string) || ''

      this.coverCache.set(cacheKey, url)
      return url
    } catch (err) {
      logger.error(`Get cover failed for ${source}:`, err)
      return ''
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — Playlist (new: paginated)
  // ---------------------------------------------------------------------------

  /**
   * Ensure a playlist's track IDs are in the registry + index.
   * Does NOT resolve covers (that's deferred to getPlaylistPage).
   * Returns the full sourceId list and total count.
   */
  async fetchFullPlaylist(
    source: MusicSource,
    playlistId: string,
    playlistTotal?: number,
    cookie?: string | null,
    type: 'playlist' | 'album' = 'playlist'
  ): Promise<{ ids: string[]; total: number }> {
    const cacheKey = `${source}:${playlistId}`

    // Check reference index — verify registry still has all tracks
    const indexed = this.playlistIndex.get(cacheKey)
    if (indexed) {
      const allPresent = indexed.ids.every((id) => this.trackRegistry.get(`${indexed.source}:${id}`) !== undefined)
      if (allPresent) {
        logger.info(`Playlist index hit: ${source}/${playlistId} (${indexed.ids.length} tracks)`)
        return { ids: indexed.ids, total: indexed.ids.length }
      }
      this.playlistIndex.delete(cacheKey)
      logger.info(`Playlist index stale (registry eviction): ${source}/${playlistId}`)
    }

    // Netease: use ncmApi.playlist_track_all to bypass Meting's 1000-track limit
    if (source === 'netease') {
      if (type === 'album') {
        return this.fetchNeteaseAlbum(playlistId, cacheKey)
      }
      return this.fetchNeteasePlaylist(playlistId, cacheKey, playlistTotal, cookie)
    }

    // Kugou: try native API (works with global_collection_id from user playlists)
    // Falls back to Meting for public playlists / special IDs
    if (source === 'kugou') {
      if (type === 'album') {
        return this.fetchMetingPlaylist(source, playlistId, cacheKey, type)
      }
      const result = await this.fetchKugouPlaylist(playlistId, cacheKey, cookie)
      if (result.total > 0) return result
      logger.info(`Kugou native API returned empty for ${playlistId}, falling back to Meting`)
    }

    // Tencent: use new native API (supports fav & custom lists)
    if (source === 'tencent') {
      if (type === 'album') {
        return this.fetchMetingPlaylist(source, playlistId, cacheKey, type)
      }
      const result = await this.fetchTencentPlaylist(playlistId, cacheKey, cookie)
      if (result.total > 0) return result
      logger.info(`Tencent native API returned empty for ${playlistId}, falling back to Meting`)
    }

    // Fallback: use Meting raw mode
    return this.fetchMetingPlaylist(source, playlistId, cacheKey, type)
  }

  /**
   * Fetch full Netease playlist via ncmApi.playlist_track_all.
   * No 1000-track limit; returns full song data including duration/album/artist.
   */
  
  /** Fetch Netease album using ncmApi.album */
  private async fetchNeteaseAlbum(
    albumId: string,
    cacheKey: string,
  ): Promise<{ ids: string[]; total: number }> {
    try {
      const res = await withTimeout(ncmApi.album({ id: albumId, timestamp: Date.now() }), 30_000)
      if (res === null) {
        logger.warn(`Netease album timeout: ${albumId}`)
        return { ids: [], total: 0 }
      }

      const songs = res?.body?.songs
      if (!Array.isArray(songs) || songs.length === 0) {
        return { ids: [], total: 0 }
      }

      const allTracks = songs.map((song: any) => this.rawToTrack(song, 'netease'))
      
      for (const t of allTracks) this.enrichFromRegistry(t)
      this.registerTracks(allTracks)

      const ids = allTracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source: 'netease', ids })

      logger.info(`Netease album ${albumId}: ${ids.length} tracks`)
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Netease album failed: ${albumId}`, err)
      return { ids: [], total: 0 }
    }
  }

  private async fetchNeteasePlaylist(
    playlistId: string,
    cacheKey: string,
    playlistTotal?: number,
    cookie?: string | null,
  ): Promise<{ ids: string[]; total: number }> {
    // Netease /api/v3/song/detail can't handle more than ~1000 IDs per request,
    // so we paginate through playlist_track_all in chunks of 1000.
    const CHUNK_SIZE = 1000
    const totalToFetch = playlistTotal || 100000
    const baseParams = { id: playlistId, timestamp: Date.now(), ...(cookie ? { cookie } : {}) }

    try {
      const allTracks: Track[] = []
      let offset = 0

      while (offset < totalToFetch) {
        const res = await withTimeout(ncmApi.playlist_track_all({ ...baseParams, limit: CHUNK_SIZE, offset }), 60_000)

        if (res === null) {
          logger.warn(`Netease playlist_track_all timeout: ${playlistId} (offset=${offset})`)
          break
        }

        const songs = res?.body?.songs
        if (!Array.isArray(songs) || songs.length === 0) {
          if (offset === 0) {
            logger.warn(`Netease playlist_track_all empty: ${playlistId}`, { code: res?.body?.code })
            return { ids: [], total: 0 }
          }
          break
        }

        const chunk = songs.map((song: Record<string, unknown>) => this.rawToTrack(song, 'netease'))
        allTracks.push(...chunk)

        // If we got fewer than CHUNK_SIZE, we've reached the end
        if (songs.length < CHUNK_SIZE) break
        offset += CHUNK_SIZE
      }

      if (allTracks.length === 0) return { ids: [], total: 0 }

      for (const t of allTracks) this.enrichFromRegistry(t)
      this.registerTracks(allTracks)

      const ids = allTracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source: 'netease', ids })

      logger.info(
        `Netease playlist ${playlistId}: ${ids.length} tracks (via ncmApi, ${Math.ceil(ids.length / CHUNK_SIZE)} chunks)`,
      )
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Netease playlist_track_all failed: ${playlistId}`, err)
      return { ids: [], total: 0 }
    }
  }

  /**
   * Fetch kugou playlist via native kugou API (global_collection_id).
   * Supports user playlists that Meting cannot access.
   */
  private async fetchKugouPlaylist(
    playlistId: string,
    cacheKey: string,
    cookie?: string | null,
  ): Promise<{ ids: string[]; total: number }> {
    try {
      const PAGE_SIZE = 300
      const allTracks: Track[] = []
      let page = 1
      let totalFromApi = 0

      // Paginate until all tracks are fetched
      while (true) {
        const { songs, total } = await kugouAuth.getPlaylistTracks(playlistId, page, PAGE_SIZE, cookie)
        if (page === 1) totalFromApi = total

        if (songs.length === 0) break

        for (const song of songs) {
          const track = this.kugouSongToTrack(song)
          if (track) allTracks.push(track)
        }

        if (allTracks.length >= totalFromApi || songs.length < PAGE_SIZE) break
        page++
      }

      if (allTracks.length === 0) return { ids: [], total: 0 }

      for (const t of allTracks) this.enrichFromRegistry(t)
      this.registerTracks(allTracks)

      const ids = allTracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source: 'kugou', ids })

      logger.info(`Kugou playlist ${playlistId}: ${ids.length} tracks (via native API, ${page} pages)`)
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Kugou playlist fetch failed: ${playlistId}`, err)
      return { ids: [], total: 0 }
    }
  }

  /**
   * Fetch Tencent playlist via native API.
   * Leverages the new encrypted-uin based getPlaylistTracks implementation.
   */
  private async fetchTencentPlaylist(
    playlistId: string,
    cacheKey: string,
    cookie?: string | null,
  ): Promise<{ ids: string[]; total: number }> {
    try {
      const PAGE_SIZE = 100
      const allTracks: Track[] = []
      let page = 1
      let totalFromApi = 0

      while (true) {
        const { songs, total } = await tencentAuth.getPlaylistTracks(playlistId, page, PAGE_SIZE, cookie)
        if (page === 1) totalFromApi = total

        if (songs.length === 0) break

        for (const song of songs) {
          const track = this.rawToTrack(song, 'tencent')
          if (track) allTracks.push(track)
        }

        if (allTracks.length >= totalFromApi || songs.length < PAGE_SIZE) break
        page++
      }

      if (allTracks.length === 0) return { ids: [], total: 0 }

      for (const t of allTracks) this.enrichFromRegistry(t)
      this.registerTracks(allTracks)

      const ids = allTracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source: 'tencent', ids })

      logger.info(`Tencent playlist ${playlistId}: ${ids.length} tracks (via native API, ${page} pages)`)
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Tencent playlist fetch failed: ${playlistId}`, err)
      return { ids: [], total: 0 }
    }
  }

  /** Convert a kugou song object from getPlaylistTracks to a Track. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- external Kugou API response shape
  private kugouSongToTrack(song: Record<string, unknown>): Track | null {
    // Cast for convenient dynamic property access
    const song_ = song as Record<string, any>
    const hash = song_.hash || song_.audio_info?.hash || ''
    if (!hash) return null

    // filename is typically "Artist - Title" or "Artist1、Artist2 - Title"
    const filename = String(song_.filename || song_.name || '')
    const parts = filename.split(' - ')
    const artistStr = parts.length > 1 ? parts[0].trim() : ''
    const artists = artistStr
      ? artistStr
          .split(/[、,，&]/)
          .map((a: string) => a.trim())
          .filter(Boolean)
      : []
    const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : filename

    // Duration: Kugou's native API returns seconds (e.g. 240), but some endpoints
    // return milliseconds (e.g. 240000). Threshold 100000 (~27 hours in seconds)
    // safely distinguishes the two — any value above it is assumed to be milliseconds.
    let duration = Number(song_.duration ?? song_.timelen ?? 0)
    if (duration > 100000) duration = Math.floor(duration / 1000)

    // VIP / privilege
    const privilege = song_.privilege ?? song_.pay_type ?? 0
    const isVip = privilege > 0

    return {
      id: nanoid(),
      source: 'kugou',
      sourceId: hash,
      title,
      artist: artists,
      album: String(song_.album_name || song_.remark || ''),
      duration,
      cover: '',
      lyricId: hash,
      urlId: hash,
      picId: hash,
      vip: isVip,
    }
  }

  /**
   * Fetch playlist via Meting raw mode — used for Tencent/Kugou.
   * Raw mode preserves VIP/pay fields and duration (format mode strips them).
   */
  private async fetchMetingPlaylist(
    source: MusicSource,
    playlistId: string,
    cacheKey: string,
    type: 'playlist' | 'album' = 'playlist'
  ): Promise<{ ids: string[]; total: number }> {
    try {
      const meting = new Meting(source)
      const raw = await withTimeout(type === 'album' ? meting.album(playlistId) : meting.playlist(playlistId), 30_000)
      if (raw === null) {
        logger.warn(`Playlist fetch timeout for ${source}: ${playlistId}`)
        return { ids: [], total: 0 }
      }

      let rawData: MetingJson
      try {
        rawData = JSON.parse(raw as string) as MetingJson
      } catch {
        logger.error(`Playlist JSON parse failed for ${source}`, (raw as string)?.substring?.(0, 200))
        return { ids: [], total: 0 }
      }

      // For Tencent album, the path is data.getSongInfo, for Kugou it's data.info
      let path = PLAYLIST_PATHS[source]
      if (type === 'album') {
        if (source === 'tencent') path = 'data.getSongInfo'
        if (source === 'kugou') path = 'data.info'
      }
      const songs = this.navigatePath(rawData, path)
      if (!Array.isArray(songs) || songs.length === 0) return { ids: [], total: 0 }

      const tracks = songs.map((song: MetingJson) => this.rawToTrack(song, source))
      for (const t of tracks) this.enrichFromRegistry(t)
      this.registerTracks(tracks)

      const ids = tracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source, ids })

      logger.info(`Playlist ${playlistId} on ${source}: ${tracks.length} tracks (raw mode)`)
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Get playlist failed for ${source}:`, err)
      return { ids: [], total: 0 }
    }
  }

  /**
   * Get a paginated slice of a playlist's tracks.
   * Covers are resolved only for the requested page, not the entire playlist.
   * After resolution, covers are written back to the registry for future reuse.
   */
  async getPlaylistPage(
    source: MusicSource,
    playlistId: string,
    limit: number,
    offset: number,
    playlistTotal?: number,
    cookie?: string | null,
    type: 'playlist' | 'album' = 'playlist'
  ): Promise<{ tracks: Track[]; total: number; hasMore: boolean }> {
    const { ids, total } = await this.fetchFullPlaylist(source, playlistId, playlistTotal, cookie, type)
    if (total === 0) return { tracks: [], total: 0, hasMore: false }

    const pageIds = ids.slice(offset, offset + limit)

    // Hydrate page from registry
    let tracks = this.hydrateFromRegistry(source, pageIds)
    if (!tracks) {
      // Registry eviction between fetchFullPlaylist and hydrate (very rare).
      // Clear index and retry once.
      this.playlistIndex.delete(`${source}:${playlistId}`)
      logger.warn(`Playlist page hydration failed, retrying: ${source}/${playlistId}`)
      const retry = await this.fetchFullPlaylist(source, playlistId, playlistTotal, cookie)
      if (retry.total === 0) return { tracks: [], total: 0, hasMore: false }
      const retryPageIds = retry.ids.slice(offset, offset + limit)
      tracks = this.hydrateFromRegistry(source, retryPageIds)
      if (!tracks) {
        logger.error(`Playlist page hydration failed after retry: ${source}/${playlistId}`)
        return { tracks: [], total: retry.total, hasMore: offset + limit < retry.total }
      }
    }

    // Resolve covers for this page only (tracks with cover already set are skipped)
    await this.batchResolveCover(tracks, source)

    // Write newly resolved covers back to registry for cross-page / cross-context reuse
    this.registerTracks(tracks)

    return { tracks, total, hasMore: offset + limit < total }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Navigate a dot-separated path in an object */
  private navigatePath(data: MetingJson, path: string): unknown {
    let result: unknown = data
    for (const key of path.split('.')) {
      result = (result as Record<string, unknown>)?.[key]
    }
    return result
  }

  /**
   * Convert raw platform-specific song data to our Track format.
   * Each platform returns different field names, so we need per-platform parsing.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- platform API shapes are too dynamic for strict typing
  private rawToTrack(song: Record<string, unknown>, source: MusicSource): Track {
    // Cast to any for convenient dynamic property access on external API responses
    const s = song as Record<string, any>
    switch (source) {
      case 'netease': {
        const neteaseArtists = s.ar?.map((a: Record<string, unknown>) => a.name).filter(Boolean)
        return {
          id: nanoid(),
          title: s.name || 'Unknown',
          artist: neteaseArtists?.length ? neteaseArtists : ['Unknown'],
          album: s.al?.name || '',
          duration: Math.round((s.dt || 0) / 1000), // ms -> seconds
          cover: '', // resolved via pic()
          source,
          sourceId: String(s.id),
          urlId: String(s.id),
          lyricId: String(s.id),
          picId: String(s.al?.pic_str || s.al?.pic || ''),
          // fee: 0=免费, 1=VIP, 4=付费专辑, 8=低音质免费
          vip: s.fee === 1 || s.fee === 4 || s.privilege?.fee === 1 || s.privilege?.fee === 4,
        }
      }

      case 'tencent': {
        // Tencent sometimes wraps data in musicData
        const t = s.musicData || s
        return {
          id: nanoid(),
          title: t.name || 'Unknown',
          artist: (t.singer || []).map((a: Record<string, unknown>) => a.name),
          album: (t.album?.title || '').trim(),
          duration: t.interval || 0, // already in seconds
          cover: '', // resolved via pic()
          source,
          sourceId: String(t.mid),
          urlId: String(t.mid),
          lyricId: String(t.mid),
          picId: String(t.album?.mid || ''),
          // pay.pay_play=1 表示需要 VIP, pay.pay_month=1 表示月度VIP, pay.price_track>0 表示付费单曲
          vip: t.pay?.pay_play === 1 || t.pay?.pay_month === 1 || (t.pay?.price_track ?? 0) > 0,
        }
      }

      case 'kugou': {
        // Kugou encodes artist/title in filename: "Artist - Title"
        const filename = s.filename || s.fileName || ''
        const parts = filename.split(' - ')
        let trackName = filename
        let artists: string[] = []
        if (parts.length >= 2) {
          artists = parts[0]
            .split(/[、,，&]/)
            .map((a: string) => a.trim())
            .filter(Boolean)
          trackName = parts.slice(1).join(' - ')
        }
        return {
          id: nanoid(),
          title: trackName || 'Unknown',
          artist: artists.length > 0 ? artists : ['Unknown'],
          album: s.album_name || '',
          duration: s.duration || 0, // seconds
          cover: '', // resolved via pic() (requires API call)
          source,
          sourceId: String(s.hash),
          urlId: String(s.hash),
          lyricId: String(s.hash),
          picId: String(s.hash),
          // privilege 位掩码: & 8 表示 VIP; pay_type > 0 也表示付费
          vip: ((s.privilege ?? 0) & 8) !== 0 || (s.pay_type ?? 0) > 0,
        }
      }

      default: {
        // Exhaustive check — if a new MusicSource is added, TypeScript will error here
        const _exhaustive: never = source
        throw new Error(`Unsupported music source: ${_exhaustive}`)
      }
    }
  }

  /**
   * Batch-resolve cover URLs for tracks that don't have one.
   * - netease/tencent: pic() is pure URL generation (instant, no API call)
   * - kugou: pic() makes an API call per track (slower)
   *
   * Each pic() call uses a fresh Meting instance to avoid race conditions.
   */
  private async batchResolveCover(tracks: Track[], source: MusicSource): Promise<void> {
    const toResolve = tracks.filter((t) => !t.cover && t.picId)
    if (toResolve.length === 0) return

    // For platforms that need API calls, limit concurrency
    const needsApiCall = source === 'kugou'
    const limit = pLimit(needsApiCall ? 3 : toResolve.length)

    await Promise.allSettled(
      toResolve.map((track) =>
        limit(async () => {
          // Check cover cache first
          const cacheKey = `${source}:${track.picId!}:300`
          const cached = this.coverCache.get(cacheKey)
          if (cached !== undefined) {
            track.cover = cached
            return
          }

          try {
            // Fresh instance per call to avoid shared state race conditions
            const instance = new Meting(source)
            const raw = await instance.pic(track.picId!, 300)
            const data = JSON.parse(raw)
            if (data.url) {
              track.cover = data.url
              this.coverCache.set(cacheKey, data.url)
            }
          } catch {
            // Leave cover empty — frontend shows placeholder
          }
        }),
      ),
    )
  }
}

export const musicProvider = new MusicProvider()
