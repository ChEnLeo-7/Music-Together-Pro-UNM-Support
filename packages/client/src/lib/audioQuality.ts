import type { AudioQuality, MusicSource, MyPlatformAuth, PlatformAuthStatus, SourcePriority, StreamSource } from '@music-together/shared'

export interface AudioQualityOption {
  value: AudioQuality
  label: string
  platform?: StreamSource
  description?: string
}

export const BASE_AUDIO_QUALITY_OPTIONS: AudioQualityOption[] = [
  { value: 128, label: '标准 128kbps' },
  { value: 192, label: '较高 192kbps' },
  { value: 320, label: '高品质 320kbps' },
]

const LOSSLESS_LABEL = '无损品质 512kbps+'

const UNM_OPTIONS: AudioQualityOption[] = [
  { value: 999, label: LOSSLESS_LABEL, platform: 'unm', description: '由 UNM 服务器提供，实际码率取决于匹配到的音源' },
]

const PLATFORM_OPTIONS: Record<MusicSource, AudioQualityOption[]> = {
  netease: [
    { value: 999, label: LOSSLESS_LABEL, platform: 'netease' },
    { value: 'netease_dolby', label: '杜比全景声', platform: 'netease' },
    { value: 'netease_hires', label: 'Hi-Res', platform: 'netease' },
    { value: 'netease_jyeffect', label: '高清臻音', platform: 'netease' },
    { value: 'netease_spatial', label: '沉浸环绕声', platform: 'netease' },
    { value: 'netease_master', label: '超清母带', platform: 'netease' },
  ],
  tencent: [
    { value: 'tencent_flac', label: LOSSLESS_LABEL, platform: 'tencent' },
    { value: 'tencent_master', label: '臻品母带', platform: 'tencent' },
  ],
  kugou: [
    { value: 'kugou_hires', label: 'Hi-Res 无损', platform: 'kugou' },
    { value: 'kugou_master', label: '臻品母带', platform: 'kugou' },
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

export function platformLabel(platform: StreamSource): string {
  if (platform === 'netease') return '网易云'
  if (platform === 'tencent') return 'QQ'
  if (platform === 'kugou') return '酷狗'
  return 'UNM'
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
  if (!source) return []

  const options: AudioQualityOption[] = [...BASE_AUDIO_QUALITY_OPTIONS]
  if (hasVip) {
    options.push(...PLATFORM_OPTIONS[source])
  }
  return filterBrowserPlayableOptions(filterAvailable(options))
}

export function getAudioQualityLabel(quality: AudioQuality, myStatus: MyPlatformAuth[]): string {
  return getAudioQualityOptions(myStatus, true).find((option) => option.value === quality)?.label ?? String(quality)
}
