import type { MusicSource } from '@music-together/shared'
import type { ShortcutMap } from '@/stores/shortcutStore'

const PREFIX = 'mt-'

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(`${PREFIX}${key}`)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, value)
  } catch {
    // quota exceeded or blocked
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${key}`)
  } catch {
    // blocked
  }
}

// Remove credentials written by versions that incorrectly used localStorage.
safeRemove('auth-cookies')

function safeSessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(`${PREFIX}${key}`)
  } catch {
    return null
  }
}

function safeSessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(`${PREFIX}${key}`, value)
  } catch {
    // quota exceeded or blocked
  }
}

function safeSessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(`${PREFIX}${key}`)
  } catch {
    // blocked
  }
}

function safeSessionGetJSON<T>(key: string): T | null {
  const raw = safeSessionGet(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// JSON helpers (safe parse / stringify through the PREFIX system)
// ---------------------------------------------------------------------------

function safeGetJSON<T>(key: string): T | null {
  const raw = safeGet(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function safeSetJSON(key: string, value: unknown): void {
  safeSet(key, JSON.stringify(value))
}

/** Parse a float from storage, returning the fallback if invalid */
function safeFloat(key: string, fallback: number): number {
  const raw = safeGet(key)
  if (raw === null) return fallback
  const parsed = parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Parse an int from storage, returning the fallback if invalid */
function safeInt(key: string, fallback: number): number {
  const raw = safeGet(key)
  if (raw === null) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Validate a string value is one of the allowed options */
function safeEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = safeGet(key) as T | null
  if (raw !== null && allowed.includes(raw)) return raw
  return fallback
}

const LYRIC_ANCHORS = ['top', 'center', 'bottom'] as const
const LANGUAGES = ['zh-CN', 'en-US'] as const

/** 所有持久化设置项的默认值 — 供 store 层的 resettable 工厂使用 */
export const SETTING_DEFAULTS = {
  ttmlEnabled: true,
  ttmlDbUrl: 'https://amlldb.bikonoo.com/ncm-lyrics/%s.ttml',
  lyricAlignAnchor: 'center' as 'top' | 'center' | 'bottom',
  lyricAlignPosition: 0.4,
  lyricEnableSpring: true,
  lyricEnableBlur: false,
  lyricEnableScale: true,
  lyricHidePassedLines: false,
  lyricClickSeekEnabled: false,
  lyricFontWeight: 600,
  lyricFontSize: 90,
  lyricTranslationFontSize: 75,
  lyricRomanFontSize: 75,
  bgFps: 30,
  bgFlowSpeed: 2,
  bgRenderScale: 0.5,
  hidePlayerQualityButton: false,
} satisfies Record<string, unknown>

export const storage = {
  /** Cached solely to identify the current user in room state; never an account credential. */
  getUserId: (): string => {
    return safeGet('userId') ?? ''
  },
  setUserId: (id: string) => safeSet('userId', id),
  clearUserId: () => safeRemove('userId'),

  getNickname: () => safeGet('nickname') ?? '',
  setNickname: (v: string) => safeSet('nickname', v),
  clearNickname: () => safeRemove('nickname'),

  getLanguage: () => safeEnum('language', LANGUAGES, 'zh-CN'),
  setLanguage: (v: (typeof LANGUAGES)[number]) => safeSet('language', v),

  getVolume: () => {
    const vol = safeFloat('volume', 0.8)
    return Math.max(0, Math.min(1, vol))
  },
  setVolume: (v: number) => safeSet('volume', String(v)),

  // Lyric settings
  getLyricAlignAnchor: () => safeEnum('lyricAlignAnchor', LYRIC_ANCHORS, SETTING_DEFAULTS.lyricAlignAnchor),
  setLyricAlignAnchor: (v: (typeof LYRIC_ANCHORS)[number]) => safeSet('lyricAlignAnchor', v),

  getLyricAlignPosition: () => {
    const pos = safeFloat('lyricAlignPosition', SETTING_DEFAULTS.lyricAlignPosition)
    return Math.max(0, Math.min(1, pos))
  },
  setLyricAlignPosition: (v: number) => safeSet('lyricAlignPosition', String(v)),

  getLyricEnableSpring: () => safeGet('lyricEnableSpring') !== 'false',
  setLyricEnableSpring: (v: boolean) => safeSet('lyricEnableSpring', String(v)),

  getLyricEnableBlur: () => safeGet('lyricEnableBlur') === 'true',
  setLyricEnableBlur: (v: boolean) => safeSet('lyricEnableBlur', String(v)),

  getLyricEnableScale: () => safeGet('lyricEnableScale') !== 'false',
  setLyricEnableScale: (v: boolean) => safeSet('lyricEnableScale', String(v)),

  getLyricHidePassedLines: () => safeGet('lyricHidePassedLines') === 'true',
  setLyricHidePassedLines: (v: boolean) => safeSet('lyricHidePassedLines', String(v)),

  getLyricClickSeekEnabled: () => safeGet('lyricClickSeekEnabled') === 'true',
  setLyricClickSeekEnabled: (v: boolean) => safeSet('lyricClickSeekEnabled', String(v)),

  getLyricFontWeight: () => {
    const w = safeInt('lyricFontWeight', SETTING_DEFAULTS.lyricFontWeight)
    return Math.max(100, Math.min(900, w))
  },
  setLyricFontWeight: (v: number) => safeSet('lyricFontWeight', String(v)),

  getLyricFontSize: () => {
    const size = safeInt('lyricFontSize', SETTING_DEFAULTS.lyricFontSize)
    return Math.max(10, Math.min(200, size))
  },
  setLyricFontSize: (v: number) => safeSet('lyricFontSize', String(v)),

  getLyricTranslationFontSize: () => {
    const size = safeInt('lyricTranslationFontSize', SETTING_DEFAULTS.lyricTranslationFontSize)
    return Math.max(10, Math.min(200, size))
  },
  setLyricTranslationFontSize: (v: number) => safeSet('lyricTranslationFontSize', String(v)),

  getLyricRomanFontSize: () => {
    const size = safeInt('lyricRomanFontSize', SETTING_DEFAULTS.lyricRomanFontSize)
    return Math.max(10, Math.min(200, size))
  },
  setLyricRomanFontSize: (v: number) => safeSet('lyricRomanFontSize', String(v)),

  // TTML 在线逐词歌词
  getTtmlEnabled: () => safeGet('ttmlEnabled') !== 'false', // 默认开启
  setTtmlEnabled: (v: boolean) => safeSet('ttmlEnabled', String(v)),

  getTtmlDbUrl: () => safeGet('ttmlDbUrl') || SETTING_DEFAULTS.ttmlDbUrl,
  setTtmlDbUrl: (v: string) => safeSet('ttmlDbUrl', v),

  // Background settings
  getBgFps: () => {
    const fps = safeInt('bgFps', SETTING_DEFAULTS.bgFps)
    return [15, 30, 60].includes(fps) ? fps : SETTING_DEFAULTS.bgFps
  },
  setBgFps: (v: number) => safeSet('bgFps', String(v)),

  getBgFlowSpeed: () => {
    const speed = safeFloat('bgFlowSpeed', SETTING_DEFAULTS.bgFlowSpeed)
    return Math.max(0.5, Math.min(5, speed))
  },
  setBgFlowSpeed: (v: number) => safeSet('bgFlowSpeed', String(v)),

  getBgRenderScale: () => {
    const scale = safeFloat('bgRenderScale', SETTING_DEFAULTS.bgRenderScale)
    return [0.25, 0.5, 0.75, 1].includes(scale) ? scale : SETTING_DEFAULTS.bgRenderScale
  },
  setBgRenderScale: (v: number) => safeSet('bgRenderScale', String(v)),

  getHidePlayerQualityButton: () => safeGet('hidePlayerQualityButton') === 'true',
  setHidePlayerQualityButton: (v: boolean) => safeSet('hidePlayerQualityButton', String(v)),

  getShortcuts: (defaults: ShortcutMap): ShortcutMap => {
    const saved = safeGetJSON<Partial<ShortcutMap>>('shortcuts') ?? {}
    return { ...defaults, ...saved }
  },
  setShortcuts: (shortcuts: ShortcutMap) => safeSetJSON('shortcuts', shortcuts),

  // Platform credentials are encrypted and restored by the server. These
  // compatibility methods intentionally never read or write browser storage.
  getAuthCookies: (): StoredCookie[] => [],
  setAuthCookies: (_cookies: StoredCookie[]) => undefined,
  clearAuthCookies: () => safeRemove('auth-cookies'),
  upsertAuthCookie: (_platform: MusicSource, _cookie: string) => undefined,
  removeAuthCookie: (_platform: MusicSource) => undefined,
  hasAuthCookie: (_platform: MusicSource): boolean => false,

  getServerAuthPersistence: () => safeGet('server-auth-persistence') !== 'false',
  setServerAuthPersistence: (v: boolean) => safeSet('server-auth-persistence', String(v)),

  getRejoinToken: (roomId: string): string | null => {
    safeRemove('rejoin-token')
    const data = safeSessionGetJSON<StoredRejoinToken>('rejoin-token')
    if (!data) return null
    if (data.roomId !== roomId) return null
    if (data.expiresAt <= Date.now()) {
      safeSessionRemove('rejoin-token')
      return null
    }
    return data.token
  },
  setRejoinToken: (roomId: string, token: string, expiresAt: number) => {
    safeRemove('rejoin-token')
    safeSessionSet('rejoin-token', JSON.stringify({ roomId, token, expiresAt } satisfies StoredRejoinToken))
  },
  clearRejoinToken: (roomId?: string) => {
    safeRemove('rejoin-token')
    const data = safeSessionGetJSON<StoredRejoinToken>('rejoin-token')
    if (!data) {
      safeSessionRemove('rejoin-token')
      return
    }
    if (roomId && data.roomId !== roomId) return
    safeSessionRemove('rejoin-token')
  },
}

/** Legacy shape retained only for type compatibility; never persisted. */
export interface StoredCookie {
  platform: MusicSource
  cookie: string
}

interface StoredRejoinToken {
  roomId: string
  token: string
  expiresAt: number
}
