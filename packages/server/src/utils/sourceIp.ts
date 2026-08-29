import type { TypedSocket } from '../middleware/types.js'
import { config } from '../config.js'

export function getSocketSourceIp(socket: TypedSocket): string {
  if (config.trustProxyHops === 0) return socket.handshake.address
  const forwarded = socket.handshake.headers['x-forwarded-for']
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (!raw) return socket.handshake.address
  const chain = raw.split(',').map((part) => part.trim()).filter(Boolean)
  return chain.at(-config.trustProxyHops) ?? socket.handshake.address
}
