import 'dotenv/config'
import * as z from 'zod/v4'
import { TIMING } from '@music-together/shared'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf-8'))

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_URL: z.string().default(''),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  STREAM_PROXY_SECRET: z.string().min(16).default('dev-stream-secret-change-me'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ROOM_ADMISSION_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  AUTO_FALLBACK_ENABLED: z.enum(['true', 'false']).default('true'),
  UNM_SERVER_URL: z.string().default(''),
  UNM_SERVER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DATABASE_URL: z.string().default('file:/app/data/music-together.db'),
})

const env = envSchema.parse(process.env)
const isProd = process.env.NODE_ENV === 'production'
if (
  isProd &&
  (!process.env.STREAM_PROXY_SECRET || ['dev-stream-secret-change-me', 'change-this-stream-proxy-secret'].includes(env.STREAM_PROXY_SECRET))
) {
  throw new Error('A random STREAM_PROXY_SECRET is required in production')
}
const explicitOrigins = [env.CLIENT_URL, ...env.CORS_ORIGINS.split(',')]
  .map((origin) => origin.trim())
  .filter(Boolean)

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
} as const
