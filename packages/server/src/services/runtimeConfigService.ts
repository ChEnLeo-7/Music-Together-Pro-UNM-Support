import { config } from '../config.js'
import { roomRepo } from '../repositories/roomRepository.js'

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function getUnmServerUrl(roomId?: string): string {
  if (roomId) {
    const roomUrl = roomRepo.get(roomId)?.unmServerUrl
    if (roomUrl) return roomUrl
  }
  return config.unm.serverUrl
}

export function normalizeUnmServerUrl(url: string): string {
  return normalizeUrl(url)
}

export function getUnmServerTimeoutMs(): number {
  return config.unm.timeoutMs
}
