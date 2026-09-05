import { config } from '../config.js'
import { roomRepo } from '../repositories/roomRepository.js'

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function getUnmServerUrl(roomId?: string): string {
  const roomUrl = roomId ? roomRepo.get(roomId)?.unmServerUrl : undefined
  return resolveUnmServerUrl(roomUrl, config.unm.serverUrl)
}

export function resolveUnmServerUrl(roomUrl: string | undefined, environmentUrl: string): string {
  return roomUrl || environmentUrl
}

export function normalizeUnmServerUrl(url: string): string {
  return normalizeUrl(url)
}

export function canConfigureRoomUnm(
  roomCreatorId: string,
  principalUserId: string | undefined,
  isServerAdmin: boolean,
  isActiveRoomMember = true,
): boolean {
  return isActiveRoomMember && Boolean(principalUserId) && (principalUserId === roomCreatorId || isServerAdmin)
}

export function getUnmServerTimeoutMs(): number {
  return config.unm.timeoutMs
}
