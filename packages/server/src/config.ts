import 'dotenv/config'
import * as z from 'zod/v4'
import { TIMING } from '@music-together/shared'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf-8'))

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_URL: z.string().default(''),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  STREAM_PROXY_SECRET: z.string().min(16).default('dev-stream-secret-change-me'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ROOM_ADMISSION_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60 * 1000),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  AUTO_FALLBACK_ENABLED: z.enum(['true', 'false']).default('true'),
  UNM_SERVER_URL: z.string().default(''),
  UNM_SERVER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DATABASE_URL: z.string().default('file:/app/data/music-together.db'),
  MEDIA_ROOT: z.string().default(''),
  MEDIA_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(200 * 1024 * 1024),
  MEDIA_MAX_DURATION_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 60 * 60),
  MEDIA_MAX_ROOM_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024 * 1024),
  MEDIA_MAX_TOTAL_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024 * 1024),
  MEDIA_INACTIVITY_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60 * 1000),
  MEDIA_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  MEDIA_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000),
  YTDLP_PATH: z.string().default('yt-dlp'),
  YTDLP_AUTO_UPDATE: z.enum(['true', 'false']).default('false'),
  YTDLP_UPDATE_VERSION: z.string().trim().default(''),
  YOUTUBE_COOKIE: z.string().default(''),
  BILIBILI_COOKIE: z.string().default(''),
  FFMPEG_PATH: z.string().default('ffmpeg'),
})

const env = envSchema.parse(process.env)
const isProd = process.env.NODE_ENV === 'production'
if (
  isProd &&
  (!process.env.STREAM_PROXY_SECRET ||
    ['dev-stream-secret-change-me', 'change-this-stream-proxy-secret'].includes(env.STREAM_PROXY_SECRET))
) {
  throw new Error('A random STREAM_PROXY_SECRET is required in production')
}
const explicitOrigins = [env.CLIENT_URL, ...env.CORS_ORIGINS.split(',')].map((origin) => origin.trim()).filter(Boolean)

export const config = {
  version: rootPkg.version as string,
  port: env.PORT,
  isProd,
  clientUrl: explicitOrigins[0] ?? 'auto',
  explicitOrigins,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  room: {
    gracePeriodMs: TIMING.ROOM_GRACE_PERIOD_MS,
  },
  player: {
    nextDebounceMs: TIMING.PLAYER_NEXT_DEBOUNCE_MS,
  },
  identity: {
    secret: env.STREAM_PROXY_SECRET,
  },
  session: {
    ttlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    cookieSecure: env.SESSION_COOKIE_SECURE ? env.SESSION_COOKIE_SECURE === 'true' : null,
  },
  roomAdmission: {
    ttlMs: env.ROOM_ADMISSION_TTL_MS,
  },
  autoFallback: {
    enabled: env.AUTO_FALLBACK_ENABLED === 'true',
  },
  unm: {
    serverUrl: env.UNM_SERVER_URL.trim().replace(/\/+$/, ''),
    timeoutMs: env.UNM_SERVER_TIMEOUT_MS,
  },
  database: {
    url: env.DATABASE_URL,
  },
  media: {
    root: path.resolve(env.MEDIA_ROOT || path.join(process.cwd(), 'data', 'media')),
    maxUploadBytes: env.MEDIA_MAX_UPLOAD_BYTES,
    maxDurationSeconds: env.MEDIA_MAX_DURATION_SECONDS,
    maxRoomBytes: env.MEDIA_MAX_ROOM_BYTES,
    maxTotalBytes: env.MEDIA_MAX_TOTAL_BYTES,
    inactivityMs: env.MEDIA_INACTIVITY_MS,
    cleanupIntervalMs: env.MEDIA_CLEANUP_INTERVAL_MS,
    jobTimeoutMs: env.MEDIA_JOB_TIMEOUT_MS,
    ytdlpPath: env.YTDLP_PATH,
    ytdlpAutoUpdate: env.YTDLP_AUTO_UPDATE === 'true',
    ytdlpUpdateVersion: env.YTDLP_UPDATE_VERSION || null,
    youtubeCookie: env.YOUTUBE_COOKIE.trim() || null,
    bilibiliCookie: env.BILIBILI_COOKIE.trim() || null,
    ffmpegPath: env.FFMPEG_PATH,
  },
} as const
