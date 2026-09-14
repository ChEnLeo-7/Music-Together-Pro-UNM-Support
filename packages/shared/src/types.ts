/** Standardised error codes used across all server → client ROOM_ERROR emissions */
export const ERROR_CODE = {
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_DATA: 'INVALID_DATA',
  INTERNAL: 'INTERNAL',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_PASSWORD_REQUIRED: 'ROOM_PASSWORD_REQUIRED',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  ROOM_GRANT_INVALID: 'ROOM_GRANT_INVALID',
  JOIN_FAILED: 'JOIN_FAILED',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_OWNER: 'NOT_OWNER',
  NO_PERMISSION: 'NO_PERMISSION',
  SET_ROLE_FAILED: 'SET_ROLE_FAILED',
  QUEUE_FULL: 'QUEUE_FULL',
  STREAM_FAILED: 'STREAM_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  NO_VOTE_NEEDED: 'NO_VOTE_NEEDED',
  VOTE_IN_PROGRESS: 'VOTE_IN_PROGRESS',
  ALREADY_VOTED: 'ALREADY_VOTED',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_PROFILE: 'INVALID_PROFILE',
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  INVALID_IMAGE: 'INVALID_IMAGE',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  LAST_ADMIN: 'LAST_ADMIN',
  CREDENTIAL_CHANGE_REQUIRED: 'CREDENTIAL_CHANGE_REQUIRED',
  INVALID_ROOM: 'INVALID_ROOM',
  INVALID_MEDIA_PATH: 'INVALID_MEDIA_PATH',
  MEDIA_ROOM_QUOTA_EXCEEDED: 'MEDIA_ROOM_QUOTA_EXCEEDED',
  MEDIA_SERVER_QUOTA_EXCEEDED: 'MEDIA_SERVER_QUOTA_EXCEEDED',
  UNSUPPORTED_AUDIO_FORMAT: 'UNSUPPORTED_AUDIO_FORMAT',
  INVALID_AUDIO_FILE: 'INVALID_AUDIO_FILE',
  VIDEO_FILE_NOT_SUPPORTED: 'VIDEO_FILE_NOT_SUPPORTED',
  AUDIO_DURATION_INVALID: 'AUDIO_DURATION_INVALID',
  REMOTE_MEDIA_UNAVAILABLE: 'REMOTE_MEDIA_UNAVAILABLE',
  MEDIA_TOO_LARGE: 'MEDIA_TOO_LARGE',
  VIDEO_HOST_NOT_SUPPORTED: 'VIDEO_HOST_NOT_SUPPORTED',
  VIDEO_EXTRACTION_TIMEOUT: 'VIDEO_EXTRACTION_TIMEOUT',
  YTDLP_NOT_INSTALLED: 'YTDLP_NOT_INSTALLED',
  VIDEO_EXTRACTION_FAILED: 'VIDEO_EXTRACTION_FAILED',
  VIDEO_AUDIO_MISSING: 'VIDEO_AUDIO_MISSING',
  MEDIA_STATE_INVALID: 'MEDIA_STATE_INVALID',
  INVALID_MEDIA_URL: 'INVALID_MEDIA_URL',
  INVALID_COOKIE_FILE: 'INVALID_COOKIE_FILE',
  COOKIE_TOO_LARGE: 'COOKIE_TOO_LARGE',
  INVALID_MULTIPART: 'INVALID_MULTIPART',
  TOO_MANY_FILES: 'TOO_MANY_FILES',
  MULTIPART_TOO_LARGE: 'MULTIPART_TOO_LARGE',
  UPLOAD_ABORTED: 'UPLOAD_ABORTED',
  MEDIA_FILE_REQUIRED: 'MEDIA_FILE_REQUIRED',
  COOKIE_REQUIRED: 'COOKIE_REQUIRED',
  INVALID_MEDIA_PLATFORM: 'INVALID_MEDIA_PLATFORM',
  INVALID_MEDIA_ACCESS: 'INVALID_MEDIA_ACCESS',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  MEDIA_FILE_MISSING: 'MEDIA_FILE_MISSING',
  MEDIA_COVER_MISSING: 'MEDIA_COVER_MISSING',
  MEDIA_DELETE_FORBIDDEN: 'MEDIA_DELETE_FORBIDDEN',
  MEDIA_IN_USE: 'MEDIA_IN_USE',
  MEDIA_PROCESSING_FAILED: 'MEDIA_PROCESSING_FAILED',
  QR_UNSUPPORTED_PLATFORM: 'QR_UNSUPPORTED_PLATFORM',
  QR_GENERATE_FAILED: 'QR_GENERATE_FAILED',
  QR_REQUEST_FAILED: 'QR_REQUEST_FAILED',
  QR_KEY_MISSING: 'QR_KEY_MISSING',
  QR_CHECK_FAILED: 'QR_CHECK_FAILED',
  COOKIE_INVALID: 'COOKIE_INVALID',
  COOKIE_OPERATION_FAILED: 'COOKIE_OPERATION_FAILED',
  COOKIE_SAVED_UNVERIFIED: 'COOKIE_SAVED_UNVERIFIED',
  CUSTOM_MEDIA_MISSING: 'CUSTOM_MEDIA_MISSING',
  CUSTOM_MEDIA_NOT_FOUND: 'CUSTOM_MEDIA_NOT_FOUND',
  STREAM_QUALITY_SWITCH_FAILED: 'STREAM_QUALITY_SWITCH_FAILED',
  STREAM_URL_FAILED: 'STREAM_URL_FAILED',
} as const

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE]

export type MusicSource = 'netease' | 'tencent' | 'kugou'

export type TrackSource = MusicSource | 'custom'
export type CustomMediaOrigin = 'upload' | 'direct-url' | 'yt-dlp'

export type AutoFallbackStatus = 'trying' | 'success' | 'failed'

export type AutoFallbackReasonType = 'VIP_REQUIRED' | 'COPYRIGHT_RESTRICTED' | 'NO_RESOURCE' | 'TIMEOUT' | 'UNKNOWN'

export interface RoomAutoFallbackEvent {
  /** Correlates trying/success/failed toasts */
  attemptId: string
  status: AutoFallbackStatus
  fromSource: Exclude<MusicSource, 'kugou'>
  toSource: Exclude<MusicSource, 'kugou'>
  trackTitle: string
  reasonType?: AutoFallbackReasonType
  /** Safe, short detail suitable for UI (no URLs/cookies/stack traces). */
  reasonDetail?: string
}

export type UserRole = 'owner' | 'admin' | 'member'

export type PlayMode = 'sequential' | 'loop-all' | 'loop-one' | 'shuffle'

/** 音频质量档位 (kbps)：标准 / 较高 / HQ / 无损 */
export type AudioQuality =
  | 128
  | 192
  | 320
  | 999
  | 'netease_dolby'
  | 'netease_hires'
  | 'netease_jyeffect'
  | 'netease_master'
  | 'netease_spatial'
  | 'tencent_flac'
  | 'tencent_master'
  | 'kugou_hires'
  | 'kugou_master'

export type StreamSource = MusicSource | 'unm' | 'custom'

export type SourcePriority = 'smart' | 'platform-first' | 'platform-only' | 'unm-first' | 'unm-only'

export interface Track {
  id: string
  title: string
  artist: string[]
  album: string
  duration: number
  cover: string
  source: TrackSource
  sourceId: string
  urlId: string
  /** Present for media uploaded/imported through the custom source. */
  kind?: 'platform' | 'custom'
  mediaId?: string
  mediaOrigin?: CustomMediaOrigin
  mimeType?: string
  lyricsUrl?: string
  lyricId?: string
  picId?: string
  streamUrl?: string
  streamSource?: StreamSource
  streamQuality?: AudioQuality
  availableStreamQualities?: AudioQuality[]
  /** 是否为 VIP / 付费歌曲（可能无法播放或仅试听） */
  vip?: boolean
  /** 点歌人昵称（服务端在加入队列时注入） */
  requestedBy?: string
}

/** 客户端可见的房间状态 */
export interface RoomState {
  id: string
  name: string
  creatorId: string
  hostId: string
  hasPassword: boolean
  audioQuality: AudioQuality
  sourcePriority: SourcePriority
  hidden: boolean
  permanent: boolean
  chatHistoryForNewUsers: boolean
  users: User[]
  /** 完整队列只在加入/刷新或队列变化时下发，普通 ROOM_STATE 会省略以避免大队列重复传输。 */
  queue?: Track[]
  currentTrack: Track | null
  playState: PlayState
  playMode: PlayMode
  pauseAtQueueEnd: boolean
  removePlayedTracks: boolean
  unmConfigured: boolean
}

export interface PlayState {
  isPlaying: boolean
  currentTime: number
  serverTimestamp: number
  /** Monotonic room playback timeline revision used to reject stale actions. */
  playbackRevision: number
}

/**
 * Scheduled action payload — server tells clients to execute an action
 * at a specific future server-time, so all clients act in unison.
 */
export interface ScheduledPlayState extends PlayState {
  /** Server-clock timestamp at which clients should execute this action */
  serverTimeToExecute: number
}

export interface User {
  id: string
  nickname: string
  role: UserRole
  avatarUrl?: string | null
  online?: boolean
}

export interface ChatMessage {
  id: string
  userId: string
  nickname: string
  content: string
  timestamp: number
  type: 'user' | 'system'
  /** Stable system event metadata; clients render this in their active language. */
  systemKey?: SystemMessageKey
  systemParams?: Record<string, string | number>
}

export type SystemMessageKey =
  | 'userJoined'
  | 'userLeft'
  | 'trackAdded'
  | 'trackPinned'
  | 'playlistImported'
  | 'playlistImportedGeneric'

export type VoteAction = 'pause' | 'resume' | 'next' | 'prev' | 'set-mode' | 'play-track' | 'remove-track'

export interface VoteState {
  id: string
  action: VoteAction
  initiatorId: string
  initiatorNickname: string
  votes: Record<string, boolean>
  requiredVotes: number
  totalUsers: number
  expiresAt: number
  /** Optional payload for parameterized actions (e.g. target play mode) */
  payload?: Record<string, unknown>
}

/** 房间列表项 -- 用于首页房间大厅展示（轻量，不含完整 queue/users） */
export interface RoomListItem {
  id: string
  name: string
  hasPassword: boolean
  hidden: boolean
  permanent: boolean
  userCount: number
  currentTrackTitle: string | null
  currentTrackArtist: string | null
}

/** 平台认证状态（前端展示用，不含 cookie 明文） */
export interface PlatformAuthStatus {
  platform: MusicSource
  /** 该平台已登录的用户数 */
  loggedInCount: number
  /** 是否有 VIP 用户 */
  hasVip: boolean
  /** 最高 VIP 等级 (0=无, 1=VIP, 11=黑胶) */
  maxVipType: number
}

/** 当前用户自己在某平台的认证信息 */
export interface MyPlatformAuth {
  platform: MusicSource
  loggedIn: boolean
  nickname?: string
  vipType?: number
}

/** 歌单元数据（用于歌单列表展示） */
export interface Playlist {
  id: string
  name: string
  cover: string
  trackCount: number
  source: MusicSource
  creator?: string
  description?: string
}
