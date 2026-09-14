import type { MusicSource, MyPlatformAuth, PlatformAuthStatus, TrackSource } from '@music-together/shared'
import type { I18nKey } from '@/lib/i18n'

export const CUSTOM_SOURCE = 'custom' as const

/** Full platform display names (used in dialogs, titles, descriptions) */
export const PLATFORM_LABEL_KEYS: Record<MusicSource, I18nKey> = {
  netease: 'netease',
  tencent: 'tencent',
  kugou: 'kugou',
}

/** Short platform labels (used in compact UI like tabs) */
export const PLATFORM_SHORT_LABEL_KEYS: Record<MusicSource, I18nKey> = {
  netease: 'neteaseShort',
  tencent: 'tencentShort',
  kugou: 'kugouShort',
}

/** Tab highlight colors per platform */
export const PLATFORM_COLORS: Record<MusicSource, string> = {
  netease: 'data-[state=active]:text-red-500',
  tencent: 'data-[state=active]:text-green-500',
  kugou: 'data-[state=active]:text-blue-500',
}

/** Active platform selector styles */
export const PLATFORM_ACTIVE: Record<MusicSource, string> = {
  netease: 'bg-red-500/15',
  tencent: 'bg-green-500/15',
  kugou: 'bg-blue-500/15',
}

/** Active platform text color */
export const PLATFORM_TEXT: Record<MusicSource, string> = {
  netease: 'text-red-500',
  tencent: 'text-green-500',
  kugou: 'text-blue-500',
}

export const TRACK_SOURCE_SHORT_LABEL_KEYS: Record<TrackSource, I18nKey> = {
  ...PLATFORM_SHORT_LABEL_KEYS,
  custom: 'customSource',
}

export const TRACK_SOURCE_ACTIVE: Record<TrackSource, string> = {
  ...PLATFORM_ACTIVE,
  custom: 'bg-violet-500/15',
}

export const TRACK_SOURCE_TEXT: Record<TrackSource, string> = {
  ...PLATFORM_TEXT,
  custom: 'text-violet-500',
}

/** VIP level display labels (Netease vipType values) */
export function getVipLabel(vipType: number, t: (key: I18nKey) => string): string {
  if (vipType === 10 || vipType === 11) return t('vipVinyl')
  if (vipType === 2) return t('vipDeluxe')
  if (vipType === 3) return t('vipSuper')
  return t('vip')
}

export function getPlatformLabel(platform: MusicSource, t: (key: I18nKey) => string): string {
  return t(PLATFORM_LABEL_KEYS[platform])
}

export function getPlatformShortLabel(platform: MusicSource, t: (key: I18nKey) => string): string {
  return t(PLATFORM_SHORT_LABEL_KEYS[platform])
}

export function getTrackSourceShortLabel(platform: TrackSource, t: (key: I18nKey) => string): string {
  return t(TRACK_SOURCE_SHORT_LABEL_KEYS[platform])
}

/** Find a platform's auth status from the room-wide status list */
export function getPlatformStatus(
  platform: MusicSource,
  statusList: PlatformAuthStatus[],
): PlatformAuthStatus | undefined {
  return statusList.find((s) => s.platform === platform)
}

/** Find the current user's auth status for a platform */
export function getMyPlatformStatus(platform: MusicSource, myStatusList: MyPlatformAuth[]): MyPlatformAuth | undefined {
  return myStatusList.find((s) => s.platform === platform)
}
