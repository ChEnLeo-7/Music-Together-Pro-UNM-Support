import type {
  AudioQuality,
  MusicSource,
  MyPlatformAuth,
  PlatformAuthStatus,
  SourcePriority,
  StreamSource,
} from '@music-together/shared'
import type { I18nKey } from '@/lib/i18n'

export interface AudioQualityOption {
  value: AudioQuality
  labelKey: I18nKey
  platform?: StreamSource
  descriptionKey?: I18nKey
}

export const BASE_AUDIO_QUALITY_OPTIONS: AudioQualityOption[] = [
  { value: 128, labelKey: 'qualityStandard' },
  { value: 192, labelKey: 'qualityHigh' },
  { value: 320, labelKey: 'qualityHq' },
]

const LOSSLESS_LABEL = 'qualityLossless' as const

const UNM_OPTIONS: AudioQualityOption[] = [
  { value: 999, labelKey: LOSSLESS_LABEL, platform: 'unm', descriptionKey: 'qualityUnmDescription' },
]

const PLATFORM_OPTIONS: Record<MusicSource, AudioQualityOption[]> = {
  netease: [
    { value: 999, labelKey: LOSSLESS_LABEL, platform: 'netease' },
    { value: 'netease_dolby', labelKey: 'qualityDolbyAtmos', platform: 'netease' },
    { value: 'netease_hires', labelKey: 'qualityHiRes', platform: 'netease' },
    { value: 'netease_jyeffect', labelKey: 'qualityJyeffect', platform: 'netease' },
    { value: 'netease_spatial', labelKey: 'qualitySpatial', platform: 'netease' },
    { value: 'netease_master', labelKey: 'qualityMaster', platform: 'netease' },
  ],
  tencent: [
    { value: 'tencent_flac', labelKey: LOSSLESS_LABEL, platform: 'tencent' },
    { value: 'tencent_master', labelKey: 'qualityTencentMaster', platform: 'tencent' },
  ],
  kugou: [
    { value: 'kugou_hires', labelKey: 'qualityKugouHiRes', platform: 'kugou' },
    { value: 'kugou_master', labelKey: 'qualityTencentMaster', platform: 'kugou' },
  ],
}

const VIP_AUDIO_QUALITIES = new Set<AudioQuality>([
  999,
  'netease_dolby',
  'netease_hires',
  'netease_jyeffect',
  'netease_master',
  'netease_spatial',
  'tencent_flac',
  'tencent_master',
  'kugou_hires',
  'kugou_master',
])

export function canPlayDolbyAtmos(): boolean {
  if (typeof document === 'undefined') return false
  const audio = document.createElement('audio')
  const dolbyProbe = audio.canPlayType('audio/mp4; codecs="ec-3"') || audio.canPlayType('audio/mp4; codecs="ac-3"')
  return dolbyProbe === 'probably' || dolbyProbe === 'maybe'
}

function filterBrowserPlayableOptions(options: AudioQualityOption[]): AudioQualityOption[] {
  if (canPlayDolbyAtmos()) return options
  return options.filter((option) => option.value !== 'netease_dolby')
}

export function platformLabel(platform: StreamSource, t: (key: I18nKey) => string): string {
  if (platform === 'netease') return t('neteaseShort')
  if (platform === 'tencent') return 'QQ'
  if (platform === 'kugou') return t('kugouShort')
  if (platform === 'custom') return t('customSource')
  return t('unmSource')
}

export function sourceToPriority(source: StreamSource): SourcePriority {
  return source === 'unm' ? 'unm-only' : 'platform-only'
}

export function getAudioQualityOptions(
  myStatus: MyPlatformAuth[] | PlatformAuthStatus[],
  includeUnm = false,
  sourcePriority: SourcePriority = 'smart',
): AudioQualityOption[] {
  if (sourcePriority === 'unm-first' || sourcePriority === 'unm-only') {
    return [...BASE_AUDIO_QUALITY_OPTIONS, ...UNM_OPTIONS]
  }

  const loggedPlatforms = new Set(
    myStatus
      .filter((status) => ('hasVip' in status ? status.hasVip : status.loggedIn && (status.vipType ?? 0) > 0))
      .map((status) => status.platform),
  )
  const options: AudioQualityOption[] = [...BASE_AUDIO_QUALITY_OPTIONS]
  for (const platform of loggedPlatforms) {
    options.push(...PLATFORM_OPTIONS[platform])
  }
  if (includeUnm && sourcePriority !== 'platform-only') options.push(...UNM_OPTIONS)
  return filterBrowserPlayableOptions(options)
}

export function getAudioQualityOptionsForSource(
  source: StreamSource | undefined,
  myStatus: MyPlatformAuth[] | PlatformAuthStatus[],
  availableQualities?: AudioQuality[],
): AudioQualityOption[] {
  const status = source ? myStatus.find((item) => item.platform === source) : undefined
  const hasVip = status ? ('hasVip' in status ? status.hasVip : status.loggedIn && (status.vipType ?? 0) > 0) : false
  const shouldTrustAvailableQualities =
    !hasVip || !availableQualities?.length || availableQualities.some((quality) => VIP_AUDIO_QUALITIES.has(quality))

  const filterAvailable = (options: AudioQualityOption[]) => {
    if (!shouldTrustAvailableQualities) return options
    if (!availableQualities?.length) return options
    const allowed = new Set<AudioQuality>(availableQualities)
    return options.filter((option) => allowed.has(option.value))
  }

  if (source === 'unm') return filterAvailable([...BASE_AUDIO_QUALITY_OPTIONS, ...UNM_OPTIONS])
  if (source === 'custom') return []
  if (!source) return []

  const options: AudioQualityOption[] = [...BASE_AUDIO_QUALITY_OPTIONS]
  if (hasVip) {
    options.push(...PLATFORM_OPTIONS[source])
  }
  return filterBrowserPlayableOptions(filterAvailable(options))
}

export function getAudioQualityLabel(
  quality: AudioQuality,
  myStatus: MyPlatformAuth[],
  t: (key: I18nKey) => string,
): string {
  const option = getAudioQualityOptions(myStatus, true).find((item) => item.value === quality)
  return option ? t(option.labelKey) : String(quality)
}
