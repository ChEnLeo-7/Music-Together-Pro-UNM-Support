import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

function signUrl(url: string): string {
  return createHmac('sha256', config.identity.secret).update(url).digest('base64url')
}

export function createStreamProxyPath(url: string, roomId?: string): string {
  const params = new URLSearchParams({ url, sig: signUrl(url) })
  if (roomId) params.set('roomId', roomId)
  return `/api/music/stream-proxy?${params.toString()}`
}

export function verifyStreamProxySignature(url: string, sig: string): boolean {
  const expected = signUrl(url)
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(sig)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}
